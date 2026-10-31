/**
 * What must be in place before `@juno/state` loads: the renderer calls
 * `window.juno` from its first render, and no element may ask for a
 * `juno:` address first. `main.ts` imports this first, and ES modules run
 * in import order.
 */
import { installUrlRewrite } from '../../page/urls'
import { installDemoBridge } from './bridge'

/**
 * The exporter copied each file into `demo/files/` and put that relative
 * path where the fake's address was. The views still wrap an avatar or an
 * image as `juno://files/avatar?url=<path>`; the copy is the path itself.
 */
function demoUrl(value: string): string {
  if (!value.startsWith('juno://')) return value
  const inner = new URL(value).searchParams.get('url')
  return inner !== null && !URL.canParse(inner) ? inner : value
}

installUrlRewrite(demoUrl)
installDemoBridge()
