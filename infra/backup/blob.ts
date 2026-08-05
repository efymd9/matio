/**
 * Хранилище бэкапов: тонкий CLI поверх `@vercel/blob`.
 *
 * ПОЧЕМУ SDK, А НЕ CURL. Плейбук (этап 06) писался под S3-совместимый R2 и
 * `aws s3`; владелец выбрал Vercel Blob (решение в issue #35: главная ценность
 * этапа — ежемесячная проба восстановления, а Blob уже подключён к проекту).
 * У Blob нет S3-API, а самодельный curl к HTTP-эндпоинту пришлось бы держать
 * в актуальном состоянии руками: подписи, многочастная загрузка, пагинация
 * листинга. SDK уже в зависимостях (`@vercel/blob`), поэтому обёртка — это
 * пять команд и ноль вендорских деталей в shell-скриптах.
 *
 * ПОЧЕМУ `access: 'private'`. В сторе `matio-blob` лежит публичный артворк шоу,
 * но доступ у Blob — свойство КАЖДОГО объекта, а не стора. Дамп несёт почту
 * 116 живых аккаунтов: даже зашифрованный age, он не должен отдаваться по
 * голому URL. Приватный объект читается только с `BLOB_READ_WRITE_TOKEN`.
 *
 * Вход (env): BLOB_READ_WRITE_TOKEN — токен стора. Значение НИКОГДА не
 * печатается: скрипты бэкапа гоняются в CI, а логи прогонов публичные.
 *
 * Команды и КОНТРАКТ ВЫВОДА (его парсят infra/backup/*.sh — не менять молча):
 *   put <файл> <pathname>     → «<pathname>\t<байт>»
 *   latest <prefix/>          → «<pathname>\t<uploadedAt ISO>\t<байт>»; выход 3, если пусто
 *   fetch <pathname> <файл>   → «<байт>»
 *   prune <prefix/> <дней>    → строки «удалён <pathname>», затем «deleted\t<N>»
 *   selftest <prefix/>        → раунд-трип запись→чтение→удаление, для проверки доступа
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { del, get, list, put, type ListBlobResultBlob } from "@vercel/blob";

import { newest, requirePrefix, selectForPrune } from "./retention";

function token(): string {
  const value = process.env.BLOB_READ_WRITE_TOKEN;
  if (!value) {
    // Имя переменной — да, значение — никогда.
    throw new Error("BLOB_READ_WRITE_TOKEN не задан");
  }
  return value;
}

/** Листинг всего префикса: Blob отдаёт страницами, курсор обязателен. */
async function listAll(prefix: string): Promise<ListBlobResultBlob[]> {
  const blobs: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000, token: token() });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

/** Общие опции записи: приватно, без случайного суффикса, без перезаписи. */
function writeOptions() {
  return {
    access: "private",
    // Имя объекта — часть контракта (по нему считается «самый свежий»),
    // случайный суффикс его сломал бы.
    addRandomSuffix: false,
    // Перезапись запрещена намеренно: молча затереть вчерашний дамп сегодняшним
    // (например, при двойном запуске воркфлоу) — это потеря точки восстановления.
    allowOverwrite: false,
    contentType: "application/octet-stream",
    // Минимум, который принимает Blob, — 60 секунд. Чтение всё равно идёт с
    // `useCache: false` (см. readBlob).
    cacheControlMaxAge: 60,
    token: token(),
  } as const;
}

/** Чтение приватного объекта целиком. */
async function readBlob(pathname: string): Promise<Buffer> {
  const result = await get(pathname, {
    access: "private",
    // Проба обязана читать то, что реально лежит в хранилище, а не то, что
    // осело в CDN-кеше: иначе «свежий» ответ мог бы пережить удалённый объект.
    useCache: false,
    token: token(),
  });
  if (!result || result.statusCode !== 200) {
    throw new Error(`объект ${pathname} не найден в хранилище`);
  }
  // База — 12 МБ (замер 05.08.2026), шифрованный дамп — единицы мегабайт,
  // поэтому читаем целиком в память вместо возни с потоками. Вырастет база на
  // порядки — здесь появится pipeline(Readable.fromWeb(...)).
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

async function cmdPut(file: string, pathname: string): Promise<void> {
  const body = await readFile(file);
  const result = await put(pathname, body, writeOptions());
  process.stdout.write(`${result.pathname}\t${body.byteLength}\n`);
}

async function cmdLatest(prefix: string): Promise<void> {
  const blob = newest(await listAll(prefix));
  if (!blob) {
    process.stderr.write(`в префиксе ${prefix} нет ни одного объекта\n`);
    // Отдельный код возврата: «пусто» — это не сбой обращения к хранилищу,
    // и вызывающий скрипт вправе отличить одно от другого.
    process.exit(3);
  }
  process.stdout.write(
    `${blob.pathname}\t${blob.uploadedAt.toISOString()}\t${blob.size}\n`,
  );
}

async function cmdFetch(pathname: string, dest: string): Promise<void> {
  const bytes = await readBlob(pathname);
  await writeFile(dest, bytes);
  process.stdout.write(`${bytes.byteLength}\n`);
}

async function cmdPrune(prefix: string, days: number): Promise<void> {
  // ГЛАВНОЕ ОТЛИЧИЕ ОТ ПЛЕЙБУКА: у Vercel Blob НЕТ lifecycle-правил, как у
  // S3/R2, — ретеншен существует ровно постольку, поскольку его выполняет этот
  // код. Забудешь — дампы копятся вечно. Правила отбора и их обоснование —
  // в ./retention.ts (там же тесты).
  const { doomed } = selectForPrune(await listAll(prefix), { days });
  for (const blob of doomed) {
    await del(blob.url, { token: token() });
    process.stdout.write(`удалён ${blob.pathname}\n`);
  }
  process.stdout.write(`deleted\t${doomed.length}\n`);
}

/**
 * Самопроверка доступа к хранилищу: запись → чтение → удаление объекта в
 * служебном префиксе. Нужна, чтобы отличить «токен не тот / приватные объекты
 * не поддерживаются» от «упал pg_dump» ДО первого настоящего прогона.
 */
async function cmdSelftest(prefix: string): Promise<void> {
  const pathname = `${prefix}selftest-${Date.now()}.bin`;
  const payload = Buffer.from(`matio blob selftest ${new Date().toISOString()}`);
  const digest = createHash("sha256").update(payload).digest("hex");

  await put(pathname, payload, writeOptions());
  try {
    const back = await readBlob(pathname);
    if (createHash("sha256").update(back).digest("hex") !== digest) {
      throw new Error("прочитанный объект не совпал с записанным");
    }
  } finally {
    // Мусор за собой убираем даже на провале: служебный объект в сторе с
    // артворком — это чужая непонятная строка в панели.
    await del(pathname, { token: token() }).catch(() => {});
  }
  process.stdout.write(`OK: раунд-трип к хранилищу прошёл (${pathname})\n`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "put": {
      const [file, pathname] = args;
      if (!file || !pathname) throw new Error("usage: put <файл> <pathname>");
      return cmdPut(file, pathname);
    }
    case "latest":
      return cmdLatest(requirePrefix(args[0]));
    case "fetch": {
      const [pathname, dest] = args;
      if (!pathname || !dest) throw new Error("usage: fetch <pathname> <файл>");
      return cmdFetch(pathname, dest);
    }
    case "prune":
      return cmdPrune(requirePrefix(args[0]), Number(args[1]));
    case "selftest":
      return cmdSelftest(requirePrefix(args[0]));
    default:
      throw new Error(
        `неизвестная команда ${JSON.stringify(command ?? null)}; есть: put, latest, fetch, prune, selftest`,
      );
  }
}

main().catch((error: unknown) => {
  // Только сообщение, без стека и без окружения: в стеке SDK может оказаться
  // URL с токеном, а логи прогонов публичные.
  process.stderr.write(
    `blob: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
