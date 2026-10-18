/** Adds the journey step to assertion and wait failures without sharing state between tests. */
export async function step(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (cause) {
    throw new Error(name, { cause })
  }
}
