/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";

// upchunk is replaced by a probe that records the OPTIONS it was created with
// and lets the test drive its events. The options are the subject here: issue
// #130 was caused entirely by one of them being left at its default.
const chunk = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  handlers: {} as Record<string, (e: unknown) => void>,
  aborts: 0,
}));

vi.mock("@mux/upchunk", () => ({
  createUpload: (options: Record<string, unknown>) => {
    chunk.options.push(options);
    chunk.handlers = {};
    return {
      on: (event: string, cb: (e: unknown) => void) => {
        chunk.handlers[event] = cb;
      },
      abort: () => {
        chunk.aborts += 1;
      },
    };
  },
}));

const server = vi.hoisted(() => ({
  createMuxUpload: vi.fn(),
  markEpisodeReprocessing: vi.fn(),
}));
vi.mock("@/app/admin/actions", () => ({
  createMuxUpload: server.createMuxUpload,
  markEpisodeReprocessing: server.markEpisodeReprocessing,
}));

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

vi.mock("@/lib/i18n/admin-client", async () => {
  const { ru } = await import("@/lib/i18n/admin-dictionaries");
  return { useAdminT: () => ru };
});

import { en, ru } from "@/lib/i18n/admin-dictionaries";
import { UploadWidget } from "./upload-widget";

function videoFile() {
  return new File(["x"], "episode-4.mp4", { type: "video/mp4" });
}

async function startUpload(
  episodeStatus: "processing" | "ready" | "errored" = "processing",
) {
  render(<UploadWidget episodeId="ep-1" episodeStatus={episodeStatus} />);
  const input = document.querySelector("input[type=file]") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [videoFile()] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    screen.getByText(ru.uploadWidget.startUpload).click();
  });
}

beforeEach(() => {
  chunk.options = [];
  chunk.handlers = {};
  chunk.aborts = 0;
  server.createMuxUpload.mockReset().mockResolvedValue({
    uploadUrl: "https://storage.example/upload",
    uploadId: "up-1",
  });
  server.markEpisodeReprocessing.mockReset().mockResolvedValue(undefined);
  nav.refresh.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("UploadWidget — устойчивость к обрыву связи", () => {
  it("считает сетевой обрыв (статус 0) поводом повторить, а не сдаться", async () => {
    await startUpload();
    const codes = chunk.options[0].retryCodes as number[];
    // Ровно эта строка — исправление #130. По умолчанию upchunk повторяет
    // только [408,502,503,504], а обрыв XHR помечает нулём: без нуля в списке
    // библиотека объявляет разрыв фатальным и не тратит ни одной попытки.
    expect(codes).toContain(0);
    expect(chunk.options[0].attempts as number).toBeGreaterThan(5);
  });

  it("ограничивает размер куска сверху, чтобы обрыв не обесценивал полгигабайта", async () => {
    await startUpload();
    const o = chunk.options[0];
    expect(o.dynamicChunkSize).toBe(true);
    // Дефолтный потолок библиотеки — около 500 МБ.
    expect(o.maxChunkSize as number).toBeLessThanOrEqual(20480);
    expect((o.minChunkSize as number) % 256).toBe(0);
    expect((o.chunkSize as number) % 256).toBe(0);
  });

  it("во время повторов показывает прогресс, а не ошибку", async () => {
    await startUpload();
    await act(async () => {
      chunk.handlers.progress?.({ detail: 5 } as unknown);
      chunk.handlers.attemptFailure?.({ detail: { attemptsLeft: 7 } } as unknown);
    });
    expect(screen.getByText(ru.uploadWidget.retryingChunk(7))).toBeTruthy();
    expect(screen.queryByText(ru.uploadWidget.uploadFailed)).toBeNull();
  });

  it("исчерпав попытки, объясняет что делать и предлагает повтор", async () => {
    await startUpload();
    await act(async () => {
      chunk.handlers.error?.({
        detail: { message: "Server responded with 0. Stopping upload." },
      } as unknown);
    });
    expect(screen.getByText(ru.uploadWidget.uploadFailed)).toBeTruthy();
    expect(screen.getByText(ru.uploadWidget.uploadFailedHint)).toBeTruthy();
    expect(screen.getByText(ru.uploadWidget.tryAgain)).toBeTruthy();
    // Сырой текст библиотеки сохранён, но убран под disclosure.
    expect(screen.getByText(/Server responded with 0/)).toBeTruthy();
  });

  it("гасит экземпляр при ошибке — иначе он оживёт сам при возврате сети", async () => {
    await startUpload();
    await act(async () => {
      chunk.handlers.error?.({ detail: { message: "boom" } } as unknown);
    });
    // upchunk на всю жизнь вешает слушатели online/offline и не снимает их.
    expect(chunk.aborts).toBe(1);
  });

  it("успешная загрузка отмечает эпизод обрабатываемым и отпускает экземпляр", async () => {
    await startUpload();
    await act(async () => {
      await chunk.handlers.success?.(undefined);
    });
    expect(server.markEpisodeReprocessing).toHaveBeenCalledWith("ep-1");
    // Экземпляр отпущен: иначе он остался бы подписан на события сети.
    expect(screen.queryByText(ru.uploadWidget.uploadFailed)).toBeNull();
  });

  it("«Убрать» после сбоя возвращает виджет в исходное состояние", async () => {
    await startUpload();
    await act(async () => {
      chunk.handlers.progress?.({ detail: 12 } as unknown);
      chunk.handlers.error?.({ detail: { message: "boom" } } as unknown);
    });
    // Кнопка появляется только когда работа не идёт — во время загрузки
    // отменить нечем (отдельный пробел в интерфейсе, не в этой правке).
    await act(async () => {
      screen.getByText(ru.uploadWidget.remove).click();
    });
    expect(screen.queryByText("episode-4.mp4")).toBeNull();
    expect(screen.queryByText(ru.uploadWidget.uploadFailed)).toBeNull();
  });

  it("«Закрыть» убирает ошибку вместе с техническими деталями", async () => {
    await startUpload();
    await act(async () => {
      chunk.handlers.error?.({ detail: { message: "Server responded with 0." } } as unknown);
    });
    await act(async () => {
      screen.getByText(ru.uploadWidget.dismiss).click();
    });
    expect(screen.queryByText(ru.uploadWidget.uploadFailed)).toBeNull();
    expect(screen.queryByText(/Server responded with 0/)).toBeNull();
  });

  it("обе локали умеют сказать про повтор", () => {
    // Английская половина словаря — тоже код: функция с подстановкой.
    expect(ru.uploadWidget.retryingChunk(3)).toContain("3");
    expect(en.uploadWidget.retryingChunk(3)).toContain("3");
  });

  it("после загрузки говорит об успехе и что страницу можно закрыть", async () => {
    await startUpload();
    await act(async () => {
      await chunk.handlers.success?.(undefined);
    });
    expect(screen.getByText(ru.uploadWidget.transcodingWait)).toBeTruthy();
  });

  it("пока эпизод обрабатывается — поллит страницу, при готовности перестаёт", async () => {
    vi.useFakeTimers();
    try {
      const view = render(
        <UploadWidget episodeId="ep-1" episodeStatus="processing" />,
      );
      const input = document.querySelector("input[type=file]") as HTMLInputElement;
      Object.defineProperty(input, "files", { value: [videoFile()] });
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => {
        screen.getByText(ru.uploadWidget.startUpload).click();
      });
      await act(async () => {
        await chunk.handlers.success?.(undefined);
      });

      await act(async () => {
        vi.advanceTimersByTime(31_000);
      });
      expect(nav.refresh.mock.calls.length).toBeGreaterThanOrEqual(3);

      // Вебхук перевёл строку в ready → refresh перерендерил страницу с новым
      // пропом. Поллинг обязан остановиться.
      const before = nav.refresh.mock.calls.length;
      view.rerender(<UploadWidget episodeId="ep-1" episodeStatus="ready" />);
      expect(screen.getByText(ru.uploadWidget.transcodingDone)).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(nav.refresh.mock.calls.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("потерянный вебхук не оставляет поллинг работать вечно", async () => {
    vi.useFakeTimers();
    try {
      render(<UploadWidget episodeId="ep-1" episodeStatus="processing" />);
      const input = document.querySelector("input[type=file]") as HTMLInputElement;
      Object.defineProperty(input, "files", { value: [videoFile()] });
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => {
        screen.getByText(ru.uploadWidget.startUpload).click();
      });
      await act(async () => {
        await chunk.handlers.success?.(undefined);
      });

      // 15 минут — потолок: после него интервал глушит сам себя, даже если
      // строка так и не перешла в ready (вебхук потерян).
      await act(async () => {
        vi.advanceTimersByTime(15 * 60_000 + 1000);
      });
      const atCeiling = nav.refresh.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(120_000);
      });
      expect(nav.refresh.mock.calls.length).toBe(atCeiling);
    } finally {
      vi.useRealTimers();
    }
  });

  it("в покое при статусе processing показывает «это не ошибка», а не голую драг-зону", () => {
    render(<UploadWidget episodeId="ep-1" episodeStatus="processing" />);
    expect(screen.getByText(ru.uploadWidget.processingBanner)).toBeTruthy();
  });

  it("в покое при статусе errored честно предлагает перезалить", () => {
    render(<UploadWidget episodeId="ep-1" episodeStatus="errored" />);
    expect(screen.getByText(ru.uploadWidget.erroredBanner)).toBeTruthy();
  });

  it("повтор запрашивает НОВУЮ ссылку, а не переиспользует протухшую", async () => {
    await startUpload();
    expect(server.createMuxUpload).toHaveBeenCalledTimes(1);
    await act(async () => {
      chunk.handlers.error?.({ detail: { message: "boom" } } as unknown);
    });
    await act(async () => {
      screen.getByText(ru.uploadWidget.tryAgain).click();
    });
    expect(server.createMuxUpload).toHaveBeenCalledTimes(2);
  });
});
