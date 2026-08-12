// Тесты правил ретеншена бэкапов (infra/backup/retention.ts). Это единственная
// в бэкапах логика, ошибка в которой УДАЛЯЕТ объекты хранилища, причём в том же
// сторе рядом лежит артворк шоу — поэтому проверяем не «вызывается», а что
// именно попадает под нож и что не попадает никогда.

import { describe, expect, it } from "vitest";

import { newest, requirePrefix, selectForPrune } from "./retention";

const NOW = new Date("2026-08-05T03:00:00Z");

function dump(stamp: string, uploadedAt: string) {
  return {
    pathname: `db-backups/production/db-${stamp}.dump.age`,
    uploadedAt: new Date(uploadedAt),
  };
}

describe("requirePrefix", () => {
  it("принимает префикс с хвостовым слэшем", () => {
    expect(requirePrefix("db-backups/production/")).toBe(
      "db-backups/production/",
    );
  });

  it("отвергает пустой префикс — иначе уборка съела бы весь стор", () => {
    expect(() => requirePrefix("")).toThrow(/непустым/);
    expect(() => requirePrefix(undefined)).toThrow(/непустым/);
  });

  it("отвергает префикс без хвостового слэша — он цепляет соседние каталоги", () => {
    expect(() => requirePrefix("db-backups")).toThrow(/«\/»/);
    expect(() => requirePrefix("shows")).toThrow(/«\/»/);
  });

  it("отвергает одинокий слэш: это тот же «весь стор»", () => {
    expect(() => requirePrefix("/")).toThrow(/непустым/);
  });
});

describe("newest", () => {
  it("берёт лексикографический максимум имени, а не самое позднее время заливки", () => {
    // Перезалитый задним числом старый ключ не должен считаться свежим:
    // именно такую подмену обязана ловить проба восстановления.
    const blobs = [
      dump("20260803T031500Z", "2026-08-03T03:15:00Z"),
      dump("20260801T031500Z", "2026-08-05T02:59:00Z"),
      dump("20260802T031500Z", "2026-08-02T03:15:00Z"),
    ];
    expect(newest(blobs)?.pathname).toContain("20260803T031500Z");
  });

  it("на пустом списке отдаёт undefined", () => {
    expect(newest([])).toBeUndefined();
  });
});

describe("selectForPrune", () => {
  it("удаляет то, что старше ретеншена, и не трогает свежее", () => {
    const blobs = [
      dump("20260601T031500Z", "2026-06-01T03:15:00Z"), // 65 дней
      dump("20260710T031500Z", "2026-07-10T03:15:00Z"), // 26 дней
      dump("20260805T031500Z", "2026-08-05T00:15:00Z"), // сегодня
    ];
    const { doomed } = selectForPrune(blobs, { days: 35, now: NOW });
    expect(doomed.map((blob) => blob.pathname)).toEqual([
      "db-backups/production/db-20260601T031500Z.dump.age",
    ]);
  });

  it("НИКОГДА не удаляет самый свежий объект, даже если он старше ретеншена", () => {
    // Сценарий «db-backup умер два месяца назад»: честная уборка оставила бы
    // хранилище вообще без копий. Пусть протухший дамп останется и громко
    // провалит пробу по возрасту.
    const blobs = [
      dump("20260501T031500Z", "2026-05-01T03:15:00Z"),
      dump("20260502T031500Z", "2026-05-02T03:15:00Z"),
    ];
    const { keep, doomed } = selectForPrune(blobs, { days: 35, now: NOW });
    expect(keep?.pathname).toContain("20260502T031500Z");
    expect(doomed.map((blob) => blob.pathname)).toEqual([
      "db-backups/production/db-20260501T031500Z.dump.age",
    ]);
  });

  it("на единственном объекте не удаляет ничего", () => {
    const blobs = [dump("20260101T031500Z", "2026-01-01T03:15:00Z")];
    expect(selectForPrune(blobs, { days: 35, now: NOW }).doomed).toEqual([]);
  });

  it("граница ретеншена: ровно N дней ещё живёт, N дней + минута уже нет", () => {
    const onEdge = dump("20260701T030000Z", "2026-07-01T03:00:00Z"); // ровно 35 дней
    const overEdge = dump("20260701T025900Z", "2026-07-01T02:59:00Z");
    const fresh = dump("20260805T000000Z", "2026-08-05T00:00:00Z");
    const { doomed } = selectForPrune([onEdge, overEdge, fresh], {
      days: 35,
      now: NOW,
    });
    expect(doomed.map((blob) => blob.pathname)).toEqual([overEdge.pathname]);
  });

  it("отвергает бессмысленный ретеншен вместо того, чтобы удалить всё", () => {
    const blobs = [dump("20260101T031500Z", "2026-01-01T03:15:00Z")];
    expect(() => selectForPrune(blobs, { days: 0, now: NOW })).toThrow(/≥ 1/);
    expect(() => selectForPrune(blobs, { days: -5, now: NOW })).toThrow(/≥ 1/);
    expect(() => selectForPrune(blobs, { days: Number.NaN, now: NOW })).toThrow(
      /≥ 1/,
    );
  });
});
