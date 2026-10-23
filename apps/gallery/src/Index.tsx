import { useState } from 'react'
import { accentNames, themeNames, type AccentName, type ThemeName } from '@juno/ui'
import { href } from './location'
import { allRoutes, components } from './registry'

interface Props {
  readonly theme: ThemeName
  readonly accent: AccentName
  readonly query: string
}

/** Every component with its state groups; each state is a link. */
export function Index({ theme, accent, query: initialQuery }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const needle = query.trim().toLowerCase()
  const visible = components
    .map((entry) => {
      if (!needle || entry.name.toLowerCase().includes(needle)) return entry
      const groups = entry.groups
        .map((group) => ({
          ...group,
          states: group.states.filter((state) => `${group.name} ${state.key}`.toLowerCase().includes(needle)),
        }))
        .filter((group) => group.states.length > 0)
      return groups.length > 0 ? { ...entry, groups } : null
    })
    .filter((entry) => entry !== null)

  return (
    <div className="g-chrome g-index">
      <header className="g-index-head">
        <h1 className="g-title">Juno gallery</h1>
        <div className="g-controls">
          <input
            className="g-search"
            type="search"
            placeholder="Filter"
            aria-label="Filter components and states"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="g-group" role="group" aria-label="Theme">
            {themeNames.map((name) => (
              <a key={name} className="g-pill" href={href(null, null, name, accent)} aria-current={name === theme ? 'true' : undefined}>
                {name}
              </a>
            ))}
          </span>
          <span className="g-group" role="group" aria-label="Accent">
            {accentNames.map((name) => (
              <a key={name} className="g-pill" href={href(null, null, theme, name)} aria-current={name === accent ? 'true' : undefined}>
                {name}
              </a>
            ))}
          </span>
        </div>
      </header>
      <p className="g-hint">
        {components.length} components, {allRoutes.length} states. Each state has its own address, for example{' '}
        <code>#/Button?__state=variant/primary&amp;theme=dark&amp;accent=claret</code>. On a component page, <kbd>j</kbd> <kbd>k</kbd> move between
        states and <kbd>[</kbd> <kbd>]</kbd> between components. Screenshots: <code>bun run gallery:shots</code>.
      </p>
      <ul className="g-components">
        {visible.map((entry) => (
          <li key={entry.name} className="g-component">
            <a className="g-component-name" href={href(entry.name, null, theme, accent)}>
              {entry.name}
            </a>
            <div className="g-component-groups">
              {entry.groups.map((group) => (
                <p key={group.id || 'ungrouped'} className="g-group-line">
                  {group.name ? <span className="g-group-name">{group.name}: </span> : null}
                  {group.states.map((state, position) => (
                    <span key={state.id}>
                      {position > 0 ? ', ' : null}
                      <a className="g-link" href={href(entry.name, state.id, theme, accent)}>
                        {state.key}
                      </a>
                    </span>
                  ))}
                </p>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
