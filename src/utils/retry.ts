import { childLogger } from './logger.js';

interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
  label: string
): Promise<T> {
  const log = childLogger({ component: 'retry', label });
  let lastErr: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < opts.maxAttempts) {
        const delay = opts.initialDelayMs * Math.pow(2, attempt - 1);
        log.warn({ attempt, delay, err }, `Attempt ${attempt} failed, retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }

  log.error({ lastErr }, `All ${opts.maxAttempts} attempts failed`);
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
