/**
 * Global browser mutex — tek Chrome sayfası olduğundan
 * provider'lar sırayla çalışmalı, aynı anda değil.
 */

let lock = Promise.resolve();

export function withBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = lock.then(() => fn());
  // Hata olsa da kilidi serbest bırak
  lock = result.then(() => {}, () => {});
  return result;
}
