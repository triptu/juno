import { defaultAccent, isAccentName, isThemeName, type AccentName, type DensityName, type ThemeName } from '@juno/ui'

/**
 * The gallery's address lives in the hash so a static host needs no routing:
 *
 *   #/                                              the index
 *   #/Button                                        the first state of Button
 *   #/Button?__state=variant/primary                one state
 *   #/Button?__state=variant/primary&theme=dark&accent=claret
 *
 * `__state` is `<group id>/<state key>`, or just `<state key>` for a state
 * with no group. `theme` and `accent` are left out when they are the defaults.
 * `density=compact` draws the state in Compact density (inventory 3.3); the
 * links the gallery makes leave it out.
 */
export interface GalleryLocation {
  readonly component: string | null
  /** The `__state` value, or the old second path segment (`#/Button/primary`). */
  readonly state: string | null
  readonly theme: ThemeName
  readonly accent: AccentName
  readonly density: DensityName
  /** The index filter. */
  readonly query: string
}

export function parseHash(hash: string): GalleryLocation {
  const [pathPart = '', search = ''] = hash.replace(/^#\/?/, '').split('?')
  const params = new URLSearchParams(search)
  const [component = null, legacyState = null] = pathPart.split('/').map((part) => (part ? decodeURIComponent(part) : null))
  const theme = params.get('theme')
  const accent = params.get('accent')
  return {
    component,
    state: params.get('__state') ?? legacyState,
    theme: isThemeName(theme) ? theme : 'light',
    accent: isAccentName(accent) ? accent : defaultAccent,
    density: params.get('density') === 'compact' ? 'compact' : 'comfortable',
    query: params.get('q') ?? '',
  }
}

export function href(component: string | null, state: string | null, theme: ThemeName, accent: AccentName): string {
  const params: string[] = []
  // The state id is already made of safe characters and a slash; keep it readable.
  if (component && state) params.push(`__state=${state}`)
  if (theme !== 'light') params.push(`theme=${theme}`)
  if (accent !== defaultAccent) params.push(`accent=${accent}`)
  return `#/${component ? encodeURIComponent(component) : ''}${params.length > 0 ? `?${params.join('&')}` : ''}`
}
