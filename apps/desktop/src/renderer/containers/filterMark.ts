import { mark } from '@juno/state/perf'

// A filter change is measured from the click to the paint of the new list
// (performance.md 1: 50 ms). The Sidebar container marks the start; the list
// container ends it after its next paint.
let pending = false

export function markFilterChange(): void {
  pending = true
  mark('juno.filter')
}

/** True once, for the paint after a mark. */
export function takeFilterMark(): boolean {
  const was = pending
  pending = false
  return was
}
