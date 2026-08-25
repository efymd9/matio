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

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock("@/lib/i18n/admin-client", async () => {
  const { ru } = await import("@/lib/i18n/admin-dictionaries");
  return { useAdminT: () => ru };
});

import { ru } from "@/lib/i18n/admin-dictionaries";
import { UploadWidget } from "./upload-widget";

function videoFile() {
  return new File(["x"], "episode-4.mp4", { type: "video/mp4" });
}

async function startUpload() {
  render(<UploadWidget episodeId="ep-1" />);
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
