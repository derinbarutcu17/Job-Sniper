export async function mapLimit<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, values.length)) }, () => worker()));
  return results;
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  attempts: number,
  sleepMs = 250,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, sleepMs * (attempt + 1)));
    }
  }
  throw lastError;
}
