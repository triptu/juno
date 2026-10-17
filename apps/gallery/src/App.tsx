import { useEffect, useLayoutEffect, useState } from 'react'
import { applyTheme } from '@juno/ui'
import { ComponentPage } from './ComponentPage'
import { Index } from './Index'
import { href, parseHash, type GalleryLocation } from './location'
import { allRoutes, components, findComponent, findState } from './registry'

function useLocation(): GalleryLocation {
  const [location, setLocation] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const update = () => setLocation(parseHash(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return location
}

/** Moves without adding a history entry, so holding j does not fill the back stack. */
function replace(hash: string) {
  window.location.replace(hash)
}

export function App() {
  const location = useLocation()
  const entry = location.component ? findComponent(location.component) : undefined
  const state = entry ? findState(entry, location.state) : undefined
  // Compact is the app's default density, so the gallery draws it unless the address or the state asks for Comfortable.
  const density = location.density ?? state?.frame.density ?? 'compact'
  useLayoutEffect(() => applyTheme(location.theme, location.accent, density), [location.theme, location.accent, density])

  useEffect(() => {
    // Exposed for the test runners, so they never have to parse the DOM.
    ;(window as unknown as { __galleryRoutes: typeof allRoutes }).__galleryRoutes = allRoutes
  }, [])

  useKeys()

  if (!location.component) return <Index theme={location.theme} accent={location.accent} query={location.query} />
  if (!entry) return <Missing text={`No component named ${location.component}.`} />
  if (!state) return <Missing text={`No state ${location.state ?? ''} on ${entry.name}.`} />
  return <ComponentPage entry={entry} state={state} theme={location.theme} accent={location.accent} />
}

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null

/**
 * j and k, or the arrow keys, walk the states of the open component; [ and ]
 * walk the components. Typing in a field is left alone, and so are the arrow
 * keys while focus is inside the fixture, because the component under test
 * may use them (a slider, a segmented control, a list).
 *
 * The handler reads the address when the key goes down, not from React state,
 * so a held key never acts on a page that has already been replaced.
 */
function useKeys() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return
      const location = parseHash(window.location.hash)
      const entry = location.component ? findComponent(location.component) : undefined
      if (!entry) return
      const { theme, accent } = location
      const state = findState(entry, location.state)
      const inFrame = event.target instanceof HTMLElement && event.target.closest('[data-fixture-frame]') !== null
      const states = entry.states
      const index = state ? states.indexOf(state) : 0
      const goState = (offset: number) => {
        const next = states[Math.min(states.length - 1, Math.max(0, index + offset))]
        if (next && next !== state) replace(href(entry.name, next.id, theme, accent))
      }
      const goComponent = (offset: number) => {
        const next = components[(components.indexOf(entry) + offset + components.length) % components.length]
        if (next) replace(href(next.name, null, theme, accent))
      }
      switch (event.key) {
        case 'j':
          goState(1)
          break
        case 'k':
          goState(-1)
          break
        case 'ArrowDown':
          if (inFrame) return
          goState(1)
          break
        case 'ArrowUp':
          if (inFrame) return
          goState(-1)
          break
        case ']':
          goComponent(1)
          break
        case '[':
          goComponent(-1)
          break
        default:
          return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

function Missing({ text }: { readonly text: string }) {
  return (
    <div className="g-chrome g-index">
      <p className="g-hint">
        {text} <a className="g-link" href="#/">Back to the index</a>.
      </p>
    </div>
  )
}
