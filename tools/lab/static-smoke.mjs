#!/usr/bin/env node
// Post-build smoke for the static UI Lab (`pnpm lab:build`).
//
// `storybook build` exits 0 as long as the BUNDLE compiles — it never opens
// the result. That is how the Lab shipped dead for weeks (#78): every story
// threw at module load («customEqualityTesters») and nothing went red. This
// script is the missing half of the build: serve `storybook-static/` from a
// throwaway node http server, open one story per stories file in headless
// Chromium (the playwright that `pnpm test:stories` already uses — no new
// dependency), and fail loudly when a story does not render or the page
// throws. Exit 1 → the build is red, as it should be.
//
// Usage: node tools/lab/static-smoke.mjs [storybook-static]
//   LAB_SMOKE_PORT — pin the port (default: an OS-assigned free one, so two
//                    parallel worktrees never collide).
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const dir = resolve(process.argv[2] ?? "storybook-static");
const port = Number(process.env.LAB_SMOKE_PORT ?? 0);
// How long one story gets to either render or show Storybook's own error
// overlay. Cold static loads of a Next-font-bearing preview take ~1–2s; 30s
// leaves room for a loaded CI runner without masking a genuine hang.
const STORY_TIMEOUT_MS = 30_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function fail(message) {
  console.error(`lab:smoke ✗ ${message}`);
  process.exitCode = 1;
}

if (!existsSync(join(dir, "index.json"))) {
  fail(`no index.json in ${dir} — run \`storybook build\` first`);
  process.exit(1);
}

// One story per stories FILE: enough to prove every story module loads and
// renders, cheap enough to run on every build. Docs entries are skipped —
// they render MDX, not the component under test.
const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
const byFile = new Map();
for (const entry of Object.values(index.entries)) {
  if (entry.type !== "story") continue;
  if (!byFile.has(entry.importPath)) byFile.set(entry.importPath, entry.id);
}
const storyIds = [...byFile.values()];
if (storyIds.length === 0) {
  fail("index.json lists no stories");
  process.exit(1);
}

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = normalize(join(dir, urlPath === "/" ? "index.html" : urlPath));
  // `normalize` collapses `..`; anything that escaped the root is a 404.
  if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(res);
});

await new Promise((ok) => server.listen(port, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

  // The verdict comes from Storybook's own channel, the way the official
  // test runner takes it: the preview assigns its channel to
  // window.__STORYBOOK_ADDONS_CHANNEL__ on boot, so an accessor installed
  // before any page script runs sees the assignment and subscribes. A story
  // that loaded, rendered and finished its play function emits
  // `storyFinished`; a play that threw ALSO finishes — Storybook logs instead
  // of throwing (`throwPlayFunctionExceptions` is off in a plain preview) —
  // but emits `playFunctionThrewException` first, and that event is the
  // signal (verified: a deliberately broken assertion in a play is reported
  // here and only here — the DOM looks rendered, the phase reads finished);
  // a module that threw at import never gets to `storyFinished` at all — the
  // body flips to `sb-show-errordisplay` instead. `storyFinished.status` is
  // checked as well, belt and braces.
  const ERROR_EVENTS = [
    "playFunctionThrewException",
    "unhandledErrorsWhilePlaying",
    "storyThrewException",
    "storyErrored",
    "storyMissing",
  ];
  await page.addInitScript((errorEvents) => {
    const events = [];
    window.__labSmokeEvents = events;
    let channel;
    Object.defineProperty(window, "__STORYBOOK_ADDONS_CHANNEL__", {
      configurable: true,
      get: () => channel,
      set: (c) => {
        channel = c;
        for (const name of ["storyFinished", ...errorEvents]) {
          c.on(name, (payload) => events.push({ name, payload }));
        }
      },
    });
  }, ERROR_EVENTS);

  const settled = () =>
    window.__labSmokeEvents.some((e) => e.name === "storyFinished") ||
    document.body.classList.contains("sb-show-errordisplay");
  const inspect = () => ({
    events: window.__labSmokeEvents,
    channelSeen: Boolean(window.__STORYBOOK_ADDONS_CHANNEL__),
    overlay: document.body.classList.contains("sb-show-errordisplay"),
    overlayText:
      document.querySelector(".sb-errordisplay")?.textContent?.trim().slice(0, 300) ?? "",
    rendered: (document.querySelector("#storybook-root")?.children.length ?? 0) > 0,
  });
  const describe = (payload) => {
    const errs = Array.isArray(payload) ? payload : [payload];
    return errs
      .map((e) => (typeof e === "string" ? e : e?.message ?? e?.description ?? JSON.stringify(e)))
      .join(" | ")
      .slice(0, 300);
  };

  let failures = 0;
  for (const id of storyIds) {
    pageErrors.length = 0;
    let timedOut = false;
    await page.goto(`${origin}/iframe.html?id=${id}&viewMode=story`, { waitUntil: "load" });
    try {
      await page.waitForFunction(settled, undefined, { timeout: STORY_TIMEOUT_MS });
    } catch {
      timedOut = true;
    }
    const v = await page.evaluate(inspect);
    const finished = v.events.find((e) => e.name === "storyFinished");

    const problems = [];
    if (!v.channelSeen) problems.push("Storybook preview never booted (no channel)");
    else if (timedOut) problems.push(`no storyFinished within ${STORY_TIMEOUT_MS}ms`);
    else if (finished && finished.payload?.status !== "success") {
      problems.push(`storyFinished with status "${finished.payload?.status}"`);
    }
    for (const e of v.events) {
      if (ERROR_EVENTS.includes(e.name)) problems.push(`${e.name}: ${describe(e.payload)}`);
    }
    if (v.overlay) problems.push(`Storybook error overlay: ${v.overlayText}`);
    if (!v.rendered) problems.push("#storybook-root is empty");
    if (pageErrors.length) problems.push(`uncaught: ${pageErrors.join(" | ").slice(0, 300)}`);

    if (problems.length) {
      failures += 1;
      fail(`${id}\n    ${problems.join("\n    ")}`);
    } else {
      console.log(`lab:smoke ✓ ${id}`);
    }
  }

  if (failures === 0) {
    console.log(`lab:smoke OK — ${storyIds.length} stories rendered from ${dir}`);
  } else {
    fail(`${failures}/${storyIds.length} stories broken — the static Lab is not usable`);
  }
} finally {
  await browser.close();
  server.close();
}
