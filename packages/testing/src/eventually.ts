/** Retries `check` until it stops throwing or `timeout` ms pass. Replaces vitest's expect.poll. */
export async function eventually<T>(check: () => T | Promise<T>, { timeout = 10_000, interval = 20 }: { timeout?: number; interval?: number } = {}): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      return await check()
    } catch (error) {
      if (Date.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
  }
}
