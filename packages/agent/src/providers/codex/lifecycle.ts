/** Removal waits for local Codex writers to exit before deleting their session files. */
const active = new Map<string, Set<{ abort: () => void; done: Promise<void> }>>()
export function codexWriter(home: string, controller: AbortController) {
  let finish!: () => void
  const entry = { abort: () => controller.abort(), done: new Promise<void>(resolve => { finish = resolve }) }
  const writers = active.get(home) ?? new Set()
  writers.add(entry)
  active.set(home, writers)
  return () => { writers.delete(entry); if (!writers.size) active.delete(home); finish() }
}
export async function stopCodexWriters(home: string) {
  const writers = [...(active.get(home) ?? [])]
  for (const writer of writers) writer.abort()
  await Promise.all(writers.map(writer => writer.done))
}
