/**
 * The read-only demo's page entry, in place of the renderer's `main.tsx`
 * (`docs/development.md`, "Demo"): the same renderer (`startRenderer`),
 * with every engine request answered from the exported snapshot
 * (`@juno/state/demo`) and `window.juno` answered in the page, reading
 * only (`readingOnly`), with the clock held at the export so the dates read
 * as they did then. It needs only static files: this script, the snapshot
 * and the files it names.
 */
import './install'
import { fixedNowAtom, registry } from '@juno/state'
import { configureDemoConnection, DEMO_SNAPSHOT_VERSION, type DemoMiss, type DemoSnapshot } from '@juno/state/demo'
import { mark } from '@juno/state/perf'
import { startRenderer } from '../../../src/renderer/start'
import type { DemoPageHandle } from './handle'

mark('juno.start')
const misses: Array<DemoMiss> = []
const handle: DemoPageHandle = { misses: () => misses }
Object.assign(window, { __junoDemo: handle })
// Relative to the page, so the demo works under any path (`/try/`).
const snapshot = fetch('demo/snapshot.json').then(async (response) => {
  if (!response.ok) throw new Error(`demo: snapshot answered ${response.status}`)
  const loaded = (await response.json()) as DemoSnapshot
  if (loaded.version !== DEMO_SNAPSHOT_VERSION) throw new Error(`demo: snapshot version ${loaded.version}, the page reads ${DEMO_SNAPSHOT_VERSION}`)
  return loaded
})
// Before the connection's own wait on the snapshot, so no row paints with today's clock first.
void snapshot.then((loaded) => registry.set(fixedNowAtom, loaded.capturedAt))
configureDemoConnection(registry, snapshot, (miss) => {
  misses.push(miss)
  console.warn('demo: the snapshot has no answer for', miss.tag, JSON.stringify(miss.payload))
})
startRenderer({ readingOnly: true })
