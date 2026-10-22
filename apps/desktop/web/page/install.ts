/**
 * What must be in place before `@juno/state` loads: it reads the launch
 * preferences from the address as its modules load, and the renderer calls
 * `window.juno` from its first render. `connect.ts` imports this before
 * `@juno/state`, and ES modules run in import order.
 */
import { installBridge } from './bridge'
import { applyLaunch } from './launch'
import { trackPointer } from './menu'
import { installUrlRewrite } from './urls'

applyLaunch()
installUrlRewrite()
installBridge()
trackPointer()
