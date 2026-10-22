/**
 * The web shell's page entry, in place of the renderer's `main.tsx`: the
 * same renderer (`startRenderer`), with the engine over a WebSocket to the
 * host and `window.juno` answered in the page (`docs/development.md`, "Web
 * shell").
 */
import { connectToEngine } from './connect'
import { mark } from '@juno/state/perf'
import { startRenderer } from '../../src/renderer/start'

mark('juno.start')
connectToEngine()
startRenderer()
