/**
 * Чистые правила ретеншена бэкапов. Вынесены из blob.ts отдельным модулем,
 * потому что это единственная в бэкапах логика, ошибка в которой УДАЛЯЕТ
 * данные: в сторе `matio-blob` рядом с дампами лежит артворк шоу, а
 * восстанавливать его неоткуда — бэкапится база, а не Blob. Здесь нет ни
 * сети, ни SDK, поэтому это можно и нужно проверять тестами
 * (infra/backup/retention.test.ts).
 */

/** Минимум того, что нам нужно от объекта хранилища (совместимо с ListBlobResultBlob). */
export interface StoredBackup {
  pathname: string;
  uploadedAt: Date;
}

/**
 * Префикс обязан быть непустым и заканчиваться «/».
 *
 * Предохранитель, а не косметика: пустой префикс превратил бы уборку
 * ретеншена в удаление всего стора вместе с постерами сайта. Хвостовой слэш
 * защищает от второй ловушки — префикс `db-backups` без слэша совпал бы и с
 * `db-backups-old/…`, и с любым соседним каталогом, начинающимся так же.
 */
export function requirePrefix(raw: string | undefined): string {
  if (!raw || !raw.endsWith("/") || raw.length < 2) {
    throw new Error(
      `префикс должен быть непустым и заканчиваться «/» (получено: ${JSON.stringify(raw ?? null)})`,
    );
  }
  return raw;
}

/**
 * Самый свежий дамп = лексикографический максимум имени.
 *
 * Ключи несут UTC-таймстемп (`db-20260805T031500Z.dump.age`), поэтому порядок
 * имён совпадает с порядком времени. Сортировать по `uploadedAt` намеренно НЕ
 * стали: перезалитый задним числом старый ключ выглядел бы свежим, а проба
 * восстановления существует ровно для того, чтобы ловить такие подмены.
 * Возраст проверяется отдельно — по `uploadedAt` найденного объекта.
 */
export function newest<T extends StoredBackup>(blobs: T[]): T | undefined {
  return blobs.reduce<T | undefined>(
    (best, blob) => (!best || blob.pathname > best.pathname ? blob : best),
    undefined,
  );
}

/**
 * Что удалять при ретеншене: всё старше `days` дней, КРОМЕ самого свежего
 * объекта.
 *
 * Исключение для свежего — не перестраховка: у Vercel Blob нет lifecycle-правил
 * S3/R2, ретеншен выполняет наш код, и связка «db-backup умер месяц назад +
 * честная уборка» оставила бы хранилище вообще без копий. Пусть лучше
 * протухший дамп останется и громко провалит пробу восстановления по возрасту.
 */
export function selectForPrune<T extends StoredBackup>(
  blobs: T[],
  options: { days: number; now?: Date },
): { keep: T | undefined; doomed: T[] } {
  const { days, now = new Date() } = options;
  if (!Number.isFinite(days) || days < 1) {
    throw new Error(`ретеншен в днях должен быть числом ≥ 1 (получено: ${days})`);
  }
  const keep = newest(blobs);
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const doomed = blobs.filter(
    (blob) =>
      blob.uploadedAt.getTime() < cutoff && blob.pathname !== keep?.pathname,
  );
  return { keep, doomed };
}
