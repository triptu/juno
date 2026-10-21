import { accentNames, FixtureAppearanceContext, themeNames, type AccentName, type ThemeName } from '@juno/ui'
import { Frame, Stage } from './Frame'
import { href } from './location'
import { components, type ComponentEntry, type StateEntry } from './registry'

interface Props {
  readonly entry: ComponentEntry
  readonly state: StateEntry
  readonly theme: ThemeName
  readonly accent: AccentName
}

/**
 * One state at a time. The switcher is plain gallery chrome (gallery.css), on
 * purpose nothing like the product: a list of states beside the frame, or a
 * select above it when the window is narrow.
 */
export function ComponentPage({ entry, state, theme, accent }: Props) {
  const index = entry.states.indexOf(state)
  return (
    <div className="g-shell">
      <nav className="g-chrome g-panel" aria-label="Gallery switcher">
        <div className="g-panel-head">
          <a className="g-link" href={href(null, null, theme, accent)}>
            All components
          </a>
          <select
            className="g-select"
            aria-label="Component"
            value={entry.name}
            onChange={(event) => (window.location.hash = href(event.target.value, null, theme, accent))}
          >
            {components.map((component) => (
              <option key={component.name} value={component.name}>
                {component.name}
              </option>
            ))}
          </select>
        </div>
        <Appearance entry={entry} state={state} theme={theme} accent={accent} />
        <div className="g-groups">
          {entry.groups.map((group) => (
            <section key={group.id || 'ungrouped'} aria-label={group.name || 'States'}>
              {group.name ? <h2 className="g-heading">{group.name}</h2> : null}
              <ul className="g-states">
                {group.states.map((item) => (
                  <li key={item.id}>
                    <a
                      className="g-state"
                      href={href(entry.name, item.id, theme, accent)}
                      aria-current={item === state ? 'true' : undefined}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="g-keys">
          <kbd>j</kbd> <kbd>k</kbd> or <kbd>↑</kbd> <kbd>↓</kbd> change state. <kbd>[</kbd> <kbd>]</kbd> change component.
        </p>
      </nav>
      <div className="g-main">
        <div className="g-chrome g-bar">
          <a className="g-link" href={href(null, null, theme, accent)}>
            All
          </a>
          <select
            className="g-select"
            aria-label="Switch component"
            value={entry.name}
            onChange={(event) => (window.location.hash = href(event.target.value, null, theme, accent))}
          >
            {components.map((component) => (
              <option key={component.name} value={component.name}>
                {component.name}
              </option>
            ))}
          </select>
          <select
            className="g-select g-select-state"
            aria-label="State"
            value={state.id}
            onChange={(event) => (window.location.hash = href(entry.name, event.target.value, theme, accent))}
          >
            {entry.groups.map((group) => (
              <optgroup key={group.id || 'ungrouped'} label={group.name || 'States'}>
                {group.states.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="g-count">
            {index + 1} / {entry.states.length}
          </span>
        </div>
        <Stage>
          {/* Keyed by state so switching always remounts the component. */}
          <FixtureAppearanceContext.Provider value={{ theme, accent }}>
            <Frame key={state.route} entry={entry} state={state} />
          </FixtureAppearanceContext.Provider>
        </Stage>
      </div>
    </div>
  )
}

function Appearance({ entry, state, theme, accent }: Props) {
  return (
    <div className="g-appearance">
      <span className="g-group" role="group" aria-label="Theme">
        {themeNames.map((name) => (
          <a
            key={name}
            className="g-pill"
            href={href(entry.name, state.id, name, accent)}
            aria-current={name === theme ? 'true' : undefined}
          >
            {name}
          </a>
        ))}
      </span>
      <span className="g-group" role="group" aria-label="Accent">
        {accentNames.map((name) => (
          <a
            key={name}
            className="g-pill"
            href={href(entry.name, state.id, theme, name)}
            aria-current={name === accent ? 'true' : undefined}
          >
            {name}
          </a>
        ))}
      </span>
    </div>
  )
}
