import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The /v1 client's hang guards and its error classification (#299).
//
// Every number here is an anti-regression: without the 3s pre-flight bound a
// Clerk that never settles is an infinite spinner on the player (it happened);
// without the 12s abort a dead connection is one too. And the error a request
// ends in decides what its caller does next — segment-queue drops a 4xx as
// final and retries anything `network`, the feed routes a 403 by its reason —
// so a mis-mapped error silently flips those decisions.
//
// global.fetch, the device id and the clock are all stubbed; the module under
// test is the real one.

const device = vi.hoisted(() => ({
  getDeviceId: null as unknown as () => Promise<string | null>,
}));
vi.mock("./device", () => ({ getDeviceId: () => device.getDeviceId() }));

const DEVICE_ID = "00000000-0000-4000-8000-000000000001";
const NEVER = () => new Promise<never>(() => {});

type Call = { url: string; init: RequestInit };
let calls: Call[];
let answer: (call: Call) => Promise<Response>;

function headersOf(call: Call | undefined): Record<string, string> {
  return (call?.init.headers ?? {}) as Record<string, string>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// A fetch that hangs until its signal aborts, then rejects the way a real one
// does.
function hangUntilAborted(call: Call): Promise<Response> {
  return new Promise((_, reject) => {
    call.init.signal?.addEventListener("abort", () => {
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      reject(err);
    });
  });
}

async function loadClient() {
  vi.resetModules();
  return import("./client");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("__DEV__", false);
  vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", undefined);
  device.getDeviceId = async () => DEVICE_ID;
  calls = [];
  answer = async () => json(200, { ok: true });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return answer(call);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("settleOrNull — the pre-flight bound", () => {
  it("answers null at 3000ms for a promise that never settles, not a millisecond sooner", async () => {
    const { settleOrNull } = await loadClient();
    let settled: unknown = "pending";
    void settleOrNull(NEVER(), 3_000).then((value) => {
      settled = value;
    });

    await vi.advanceTimersByTimeAsync(2_999);
    expect(settled).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeNull();
  });

  it("answers null for a rejection and the value for a resolution", async () => {
    const { settleOrNull } = await loadClient();
    await expect(settleOrNull(Promise.reject(new Error("keychain")), 3_000)).resolves.toBeNull();
    await expect(settleOrNull(Promise.resolve("v"), 3_000)).resolves.toBe("v");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("public reads never ask Clerk (auth: false)", () => {
  it("config, catalog and a show go out at once with the device id and no Authorization, even with a Clerk that never answers", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    const provider = vi.fn(NEVER);
    setAuthTokenProvider(provider);

    const pending = [api.config(), api.catalog(), api.show("the scarlet/oath")];
    await vi.advanceTimersByTimeAsync(0);

    expect(calls.map((c) => c.url)).toEqual([
      "https://matio.tv/api/v1/config",
      "https://matio.tv/api/v1/catalog",
      "https://matio.tv/api/v1/shows/the%20scarlet%2Foath",
    ]);
    for (const call of calls) {
      expect(headersOf(call).Authorization).toBeUndefined();
      expect(headersOf(call)["X-Matio-Device-Id"]).toBe(DEVICE_ID);
    }
    expect(provider).not.toHaveBeenCalled();
    await expect(Promise.all(pending)).resolves.toHaveLength(3);
  });

  it("stays anonymous for a signed-in viewer too — an Authorization header would keep the CDN copy out of reach", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(async () => "sess_token");

    await api.catalog();

    expect(headersOf(calls[0]).Authorization).toBeUndefined();
  });
});

describe("personal requests (auth: optional — the playback token, continue)", () => {
  it("send the session token as a Bearer when Clerk answers", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(async () => "sess_token");

    await api.playbackToken("ep_1");

    expect(headersOf(calls[0]).Authorization).toBe("Bearer sess_token");
    expect(headersOf(calls[0])["X-Matio-Device-Id"]).toBe(DEVICE_ID);
    expect(calls[0]?.init.body).toBe(JSON.stringify({ episodeId: "ep_1" }));
  });

  it("go out anonymous after 3s when Clerk never answers — never later, never stuck", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(NEVER);

    const pending = api.continueWatching();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(calls).toHaveLength(1);
    expect(headersOf(calls[0]).Authorization).toBeUndefined();
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("wait for the keychain and Clerk side by side: both stalled cost 3s, not 6s", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    device.getDeviceId = NEVER;
    setAuthTokenProvider(NEVER);

    void api.playbackToken("ep_1");
    await vi.advanceTimersByTimeAsync(3_000);

    expect(calls).toHaveLength(1);
    expect(headersOf(calls[0])["X-Matio-Device-Id"]).toBeUndefined();
    expect(headersOf(calls[0]).Authorization).toBeUndefined();
  });

  it("treat a provider that throws instead of rejecting as no answer", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(() => {
      throw new Error("clerk exploded");
    });

    await expect(api.playbackToken("ep_1")).resolves.toEqual({ ok: true });
    expect(headersOf(calls[0]).Authorization).toBeUndefined();
  });
});

describe("writes that belong to a person (auth: required — progress, retention buckets)", () => {
  it("send the Bearer when Clerk answers with a token", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(async () => "sess_token");

    await api.saveProgress({ episodeId: "ep_1", positionSeconds: 42, completed: false });

    expect(headersOf(calls[0]).Authorization).toBe("Bearer sess_token");
  });

  it("fail as a network error — before any fetch — when Clerk does not answer in 3s", async () => {
    const { api, ApiError, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(NEVER);

    const outcome = api
      .saveWatchSegments({ episodeId: "ep_1", buckets: [0, 1] })
      .catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(3_000);

    const err = await outcome;
    expect(err).toBeInstanceOf(ApiError);
    // `network` is what segment-queue retries; a 401/403 it would drop as final.
    expect(err).toMatchObject({ code: "network", status: 0 });
    expect(calls).toHaveLength(0);
  });

  it("fail the same way when the token lookup rejects", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(() => Promise.reject(new Error("offline")));

    await expect(
      api.saveProgress({ episodeId: "ep_1", positionSeconds: 42, completed: false }),
    ).rejects.toMatchObject({ code: "network", status: 0 });
    expect(calls).toHaveLength(0);
  });

  it("still go out, device-keyed, when Clerk answers that nobody is signed in — a signed-out viewer's flush is theirs", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(async () => null);

    await api.saveWatchSegments({ episodeId: "ep_1", buckets: [0] });

    expect(calls).toHaveLength(1);
    expect(headersOf(calls[0]).Authorization).toBeUndefined();
    expect(headersOf(calls[0])["X-Matio-Device-Id"]).toBe(DEVICE_ID);
  });

  it("still go out in a build with no Clerk at all (no provider)", async () => {
    const { api } = await loadClient();

    await api.saveWatchSegments({ episodeId: "ep_1", buckets: [0] });

    expect(calls).toHaveLength(1);
    expect(headersOf(calls[0]).Authorization).toBeUndefined();
  });
});

describe("the per-episode resume read (#303 — auth: required)", () => {
  it("is a GET of /v1/progress for that episode, carrying the Bearer", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(async () => "sess_token");
    answer = async () => json(200, { positionSeconds: 240 });

    await expect(api.episodeProgress("ep 1/x")).resolves.toEqual({ positionSeconds: 240 });

    expect(calls[0].url).toBe("https://matio.tv/api/v1/progress?episodeId=ep%201%2Fx");
    expect(calls[0].init.method).toBe("GET");
    expect(headersOf(calls[0]).Authorization).toBe("Bearer sess_token");
  });

  it("never goes out anonymous when Clerk does not answer — the answer is only the Bearer's owner's", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(NEVER);

    const outcome = api.episodeProgress("ep_1").catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toMatchObject({ code: "network", status: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe("the 12s request deadline", () => {
  it("rejects a fetch that never answers at 12s with ApiError{network, 0}", async () => {
    const { api, ApiError } = await loadClient();
    answer = hangUntilAborted;

    const outcome = api.catalog().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(11_999);
    expect(calls[0]?.init.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const err = await outcome;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "network", status: 0, message: "The request timed out." });
  });

  it("starts only once the headers exist: a 3s Clerk wait does not eat into it", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(NEVER);
    answer = hangUntilAborted;

    const outcome = api.playbackToken("ep_1").catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(3_000 + 11_999);
    expect(calls[0]?.init.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(calls[0]?.init.signal?.aborted).toBe(true);
    await expect(outcome).resolves.toMatchObject({ code: "network", status: 0 });
  });

  it("leaves no timer behind once an answer arrives", async () => {
    const { api } = await loadClient();

    await api.config();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("error classification", () => {
  it("an unreachable server is `network` with status 0", async () => {
    const { api } = await loadClient();
    answer = () => Promise.reject(new TypeError("Network request failed"));

    await expect(api.catalog()).rejects.toMatchObject({
      code: "network",
      status: 0,
      message: "Couldn't reach Matio.",
    });
  });

  it("a 403 keeps the server's code, status and reason — the feed routes the wall by it", async () => {
    const { api, ApiError } = await loadClient();
    answer = async () =>
      json(403, {
        error: { code: "forbidden", message: "Sign up to keep watching", reason: "signup_required" },
      });

    const err = await api.playbackToken("ep_2").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      code: "forbidden",
      status: 403,
      reason: "signup_required",
      message: "Sign up to keep watching",
    });
  });

  it("a 502 with an HTML body is server_error 502 — retryable, not a refusal", async () => {
    const { api } = await loadClient();
    answer = async () =>
      new Response("<html><body>Bad gateway</body></html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      });

    await expect(api.catalog()).rejects.toMatchObject({ code: "server_error", status: 502 });
  });

  it("a 200 whose body is not JSON is `malformed`", async () => {
    const { api } = await loadClient();
    answer = async () => new Response("{not json", { status: 200 });

    await expect(api.config()).rejects.toMatchObject({ code: "malformed", status: 200 });
  });

  it("a 200 with JSON is the body, as is", async () => {
    const { api } = await loadClient();
    answer = async () => json(200, { shows: [] });

    await expect(api.catalog()).resolves.toEqual({ shows: [] });
  });
});

describe("deleteAccount (#309) — the one request with a longer deadline", () => {
  it("POSTs to /api/v1/account/delete with the Bearer and no body", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(async () => "sess_token");

    await expect(api.deleteAccount()).resolves.toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://matio.tv/api/v1/account/delete");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBeUndefined();
    expect(headersOf(calls[0]).Authorization).toBe("Bearer sess_token");
  });

  it("never goes out anonymously when Clerk does not answer — a network error before any fetch", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(NEVER);

    const outcome = api.deleteAccount().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toMatchObject({ code: "network", status: 0 });
    expect(calls).toHaveLength(0);
  });

  it("waits 45s, not 12s, for a server that is still cancelling at Stripe", async () => {
    const { api, setAuthTokenProvider, ACCOUNT_DELETE_TIMEOUT_MS } = await loadClient();
    setAuthTokenProvider(async () => "sess_token");
    answer = hangUntilAborted;

    const outcome = api.deleteAccount().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(calls[0]?.init.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(ACCOUNT_DELETE_TIMEOUT_MS - 12_000);

    expect(ACCOUNT_DELETE_TIMEOUT_MS).toBe(45_000);
    expect(calls[0]?.init.signal?.aborted).toBe(true);
    await expect(outcome).resolves.toMatchObject({ code: "network", status: 0 });
  });

  // #398 — the Account tab concludes "the account is gone" from a dead session
  // only after a request that could have erased it went out.
  it("reports a request carrying the Bearer the moment it leaves — before any answer, which may never come", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(async () => "sess_token");
    answer = hangUntilAborted;
    const onSentWithToken = vi.fn();

    const outcome = api.deleteAccount({ onSentWithToken }).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(onSentWithToken).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(45_000);
    await expect(outcome).resolves.toMatchObject({ code: "network", status: 0 });
    expect(onSentWithToken).toHaveBeenCalledTimes(1);
  });

  it("does not report a request sent with no Bearer (Clerk: nobody signed in) — its 401 erased nothing", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(async () => null);
    answer = async () =>
      json(401, { error: { code: "unauthorized", message: "Sign in to delete your account." } });
    const onSentWithToken = vi.fn();

    await expect(api.deleteAccount({ onSentWithToken })).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);
    expect(headersOf(calls[0]).Authorization).toBeUndefined();
    expect(onSentWithToken).not.toHaveBeenCalled();
  });

  it("does not report anything when Clerk does not answer — nothing went out", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(NEVER);
    const onSentWithToken = vi.fn();

    const outcome = api.deleteAccount({ onSentWithToken }).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toMatchObject({ code: "network", status: 0 });
    expect(calls).toHaveLength(0);
    expect(onSentWithToken).not.toHaveBeenCalled();
  });

  it("keeps the server's code on a refusal — the Account tab says it failed and keeps the session", async () => {
    const { api, setAuthTokenProvider } = await loadClient();
    setAuthTokenProvider(async () => "sess_token");
    answer = async () =>
      json(500, { error: { code: "server_error", message: "Couldn't delete your account." } });

    await expect(api.deleteAccount()).rejects.toMatchObject({
      code: "server_error",
      status: 500,
    });
  });
});
