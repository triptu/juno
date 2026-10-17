import { isT3ThreadUrl } from '@juno/agent-contract'
import { shell } from 'electron'

/** Under JUNO_E2E, links for the browser are recorded here instead of opening it. */
export const browserLinksForTests: string[] = []
const e2e = process.env.JUNO_E2E === '1'

/** Opens a link outside Juno, when it is http, https, mailto or a T3 thread. Anything else is dropped. */
export function openInBrowser(url: string): void {
  if (!isWebUrl(url) && !isT3ThreadUrl(url)) return
  if (e2e) browserLinksForTests.push(url)
  else void shell.openExternal(url)
}

function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  } catch {
    return false
  }
}
