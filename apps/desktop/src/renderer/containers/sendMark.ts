import { mark } from '@juno/state/perf'

// A send is measured from Enter to the paint of its pending row
// (performance.md 1: 50 ms). The composer marks the start; the topic's list
// ends it after the paint that shows the row.
let pending = false

export function markSend(): void {
  pending = true
  mark('juno.send')
}

/** True once, for the paint after a mark. */
export function takeSendMark(): boolean {
  const was = pending
  pending = false
  return was
}
