import type { DemoMiss } from '@juno/state/demo'

/** What the demo page tells a test through `window.__junoDemo`. */
export interface DemoPageHandle {
  /** Requests the snapshot had no answer for, in order. */
  readonly misses: () => ReadonlyArray<DemoMiss>
}
