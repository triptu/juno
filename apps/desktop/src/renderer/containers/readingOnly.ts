/**
 * Whether this window only reads: the read-only demo (`web/demo/page`,
 * `docs/development.md`, "Demo"). It shows the sidebar, topics, tabs and
 * peek, and leaves out every page (Home, Search, All topics, Settings,
 * Juno), every write and everything native. The entry says so through
 * `startRenderer`, before the first render, and it never changes after.
 * Containers turn it into view props; views never read it.
 */
let reading = false

export function readingOnly(): boolean {
  return reading
}

/** Called once by `startRenderer`, before anything renders. */
export function setReadingOnly(): void {
  reading = true
}
