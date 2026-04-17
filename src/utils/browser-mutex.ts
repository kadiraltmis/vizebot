/**
 * Global browser mutex — tek Chrome sayfası olduğundan
 * provider'lar sırayla çalışmalı, aynı anda değil.
 */

let lock = Promise.resolve();

export function withBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = lock.then(() => fn());
  // Hata olsa bile kilidi serbest bırak ama hatayı sessizce yutma
  lock = result.then(
    () => {},
    (err) => {
      console.error('[browser-mutex] Kilitleme hatası:', err);
      throw err;
    }
  );
  return result;
}
