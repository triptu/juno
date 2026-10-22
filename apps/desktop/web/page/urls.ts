/**
 * `juno://` addresses in a browser. In Electron, main serves the `juno:`
 * scheme (thumbnails, avatars, uploads, Home's pictures); a browser cannot
 * load it at all. The engine and the views write those addresses as they
 * are, so the page maps each one to the same path under `SCHEME_PREFIX` on
 * its own origin, where the host serves it, before the browser sees it:
 * on the attributes and properties that load media, and on `fetch`.
 *
 * Installed once, before the renderer runs, so no element ever asks for a
 * `juno:` address and fails first.
 */
import { SCHEME_PREFIX } from '../paths'

/** `juno://files/F1/thumb?url=…` as `/__juno/files/F1/thumb?url=…`; anything else unchanged. */
export function pageUrl(value: string): string {
  return value.startsWith('juno://') ? SCHEME_PREFIX + value.slice('juno://'.length) : value
}

const LOADING_ATTRIBUTES = new Set(['src', 'poster', 'href', 'srcset'])

function patchProperty(prototype: object, name: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
  const set = descriptor?.set
  if (descriptor === undefined || set === undefined) return
  Object.defineProperty(prototype, name, {
    ...descriptor,
    set(this: Element, value: unknown) {
      set.call(this, typeof value === 'string' ? pageUrl(value) : value)
    },
  })
}

export function installUrlRewrite(): void {
  const setAttribute = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    setAttribute.call(this, name, LOADING_ATTRIBUTES.has(name.toLowerCase()) && typeof value === 'string' ? pageUrl(value) : value)
  }
  patchProperty(HTMLImageElement.prototype, 'src')
  patchProperty(HTMLMediaElement.prototype, 'src')
  patchProperty(HTMLSourceElement.prototype, 'src')
  patchProperty(HTMLIFrameElement.prototype, 'src')
  patchProperty(HTMLVideoElement.prototype, 'poster')
  patchProperty(HTMLAnchorElement.prototype, 'href')

  const fetch = window.fetch.bind(window)
  window.fetch = (input, init) => fetch(typeof input === 'string' ? pageUrl(input) : input instanceof URL ? pageUrl(input.href) : input, init)
}
