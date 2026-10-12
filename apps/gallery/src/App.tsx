import * as stylex from '@stylexjs/stylex'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { colors, radii, spacing, text } from '@juno/tokens/tokens.stylex'
import type { AccentName } from '@juno/tokens/themes.stylex'
import type { FixtureFrame } from '@juno/ui'
import { allRoutes, registry, type AnyFixtureSet } from './registry'
import { accentNames, applyTheme, isAccentName, isThemeName, themeNames, type ThemeName } from './theme'

interface Location {
  readonly component: string | null
  readonly fixture: string | null
  readonly theme: ThemeName
  readonly accent: AccentName
  readonly query: string
}

function parseHash(hash: string): Location {
  const [pathPart = '', search = ''] = hash.replace(/^#\/?/, '').split('?')
  const params = new URLSearchParams(search)
  const [component = null, fixture = null] = pathPart.split('/').map((part) => (part ? decodeURIComponent(part) : null))
  const theme = params.get('theme')
  const accent = params.get('accent')
  return {
    component,
    fixture,
    theme: isThemeName(theme) ? theme : 'light',
    accent: isAccentName(accent) ? accent : 'ink',
    query: params.get('q') ?? '',
  }
}

function href(component: string | null, fixture: string | null, theme: ThemeName, accent: AccentName): string {
  const path = component ? `/${encodeURIComponent(component)}${fixture ? `/${encodeURIComponent(fixture)}` : ''}` : '/'
  const params = new URLSearchParams()
  if (theme !== 'light') params.set('theme', theme)
  if (accent !== 'ink') params.set('accent', accent)
  const search = params.toString()
  return `#${path}${search ? `?${search}` : ''}`
}

function useLocation(): Location {
  const [location, setLocation] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const update = () => setLocation(parseHash(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return location
}

export function App() {
  const location = useLocation()
  useLayoutEffect(() => applyTheme(location.theme, location.accent), [location.theme, location.accent])

  if (location.component && location.fixture) {
    const set = registry[location.component]
    const fixture = set?.fixtures[location.fixture]
    if (!set || !fixture) return <Missing component={location.component} fixture={location.fixture} />
    // Keyed by route so switching fixtures always remounts the component.
    return <FixturePage key={`${location.component}/${location.fixture}`} set={set} fixtureName={location.fixture} />
  }
  return <Index location={location} />
}

function FixturePage({ set, fixtureName }: { readonly set: AnyFixtureSet; readonly fixtureName: string }) {
  const fixture = set.fixtures[fixtureName]
  if (!fixture) return null
  const frame: FixtureFrame = { ...set.frame, ...fixture.frame }
  const Component = set.component
  const content = fixture.render ? fixture.render() : <Component {...fixture.props} />
  return (
    <div {...stylex.props(styles.stage)}>
      <div
        data-fixture-frame
        {...stylex.props(
          styles.frame,
          frame.padded !== false && styles.framePadded,
          surfaces[frame.surface ?? 'background'],
          frame.width !== undefined && styles.frameWidth(frame.width),
          frame.height !== undefined && styles.frameHeight(frame.height),
        )}
      >
        {content}
      </div>
    </div>
  )
}

function Index({ location }: { readonly location: Location }) {
  const [query, setQuery] = useState(location.query)
  const routes = useMemo(() => allRoutes(), [])
  const needle = query.trim().toLowerCase()
  const visible = needle ? routes.filter((route) => `${route.component}/${route.fixture}`.toLowerCase().includes(needle)) : routes
  const components = [...new Set(visible.map((route) => route.component))]

  useEffect(() => {
    // Exposed for the screenshot runner, so it never has to parse the DOM.
    ;(window as unknown as { __galleryRoutes: ReadonlyArray<{ component: string; fixture: string }> }).__galleryRoutes = routes
  }, [routes])

  return (
    <div {...stylex.props(styles.index)}>
      <header {...stylex.props(styles.indexHeader)}>
        <h1 {...stylex.props(styles.title)}>Juno gallery</h1>
        <div {...stylex.props(styles.controls)}>
          <input
            type="search"
            placeholder="Filter"
            aria-label="Filter fixtures"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            {...stylex.props(styles.search)}
          />
          <span {...stylex.props(styles.group)}>
            {themeNames.map((theme) => (
              <a
                key={theme}
                href={href(null, null, theme, location.accent)}
                aria-current={theme === location.theme ? 'true' : undefined}
                {...stylex.props(styles.pill, theme === location.theme && styles.pillActive)}
              >
                {theme}
              </a>
            ))}
          </span>
          <span {...stylex.props(styles.group)}>
            {accentNames.map((accent) => (
              <a
                key={accent}
                href={href(null, null, location.theme, accent)}
                aria-current={accent === location.accent ? 'true' : undefined}
                {...stylex.props(styles.pill, accent === location.accent && styles.pillActive)}
              >
                {accent}
              </a>
            ))}
          </span>
        </div>
      </header>
      <p {...stylex.props(styles.hint)}>
        {routes.length} fixtures. Routes look like <code>#/Button/primary?theme=dark&amp;accent=claret</code>. Screenshots:{' '}
        <code>pnpm gallery:shots</code>.
      </p>
      <div {...stylex.props(styles.grid)}>
        {components.map((component) => (
          <section key={component} {...stylex.props(styles.section)}>
            <h2 {...stylex.props(styles.sectionTitle)}>{component}</h2>
            <ul {...stylex.props(styles.list)}>
              {visible
                .filter((route) => route.component === component)
                .map((route) => (
                  <li key={route.fixture}>
                    <a href={href(route.component, route.fixture, location.theme, location.accent)} {...stylex.props(styles.link)}>
                      {route.fixture}
                    </a>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

function Missing({ component, fixture }: { readonly component: string; readonly fixture: string }) {
  return (
    <div {...stylex.props(styles.index)}>
      <p {...stylex.props(styles.hint)}>
        No fixture <code>{fixture}</code> on <code>{component}</code>. <a href="#/">Back to the index</a>.
      </p>
    </div>
  )
}

const styles = stylex.create({
  stage: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    padding: spacing['--space-6'],
    backgroundColor: colors['--background'],
    overflow: 'auto',
  },
  frame: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    position: 'relative',
    boxSizing: 'border-box',
    maxWidth: '100%',
    overflow: 'hidden',
  },
  framePadded: {
    padding: spacing['--space-6'],
  },
  frameWidth: (px: number) => ({ width: px }),
  frameHeight: (px: number) => ({ height: px }),
  index: {
    maxWidth: '960px',
    marginInline: 'auto',
    paddingBlock: spacing['--space-10'],
    paddingInline: spacing['--space-8'],
    minHeight: '100vh',
    overflow: 'auto',
    userSelect: 'text',
  },
  indexHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-4'],
  },
  title: {
    margin: 0,
    fontFamily: text['--text-page-title-family'],
    fontSize: text['--text-page-title-size'],
    fontWeight: text['--text-page-title-weight'],
    lineHeight: text['--text-page-title-leading'],
    letterSpacing: text['--text-page-title-tracking'],
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    flexWrap: 'wrap',
  },
  search: {
    height: '30px',
    paddingInline: spacing['--space-2-5'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--input-border'],
    borderRadius: radii['--radius-md-plus'],
    backgroundColor: colors['--surface-default'],
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: text['--text-ui-size'],
    outlineColor: colors['--focus-ring'],
  },
  group: {
    display: 'inline-flex',
    gap: spacing['--space-0-5'],
    padding: spacing['--space-0-5'],
    backgroundColor: colors['--surface-hover'],
    borderRadius: radii['--radius-md-plus'],
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    height: '24px',
    paddingInline: spacing['--space-2'],
    borderRadius: radii['--radius-sm'],
    fontSize: text['--text-meta-size'],
    fontWeight: 500,
    color: colors['--foreground-muted'],
    textDecoration: 'none',
  },
  pillActive: {
    color: colors['--foreground-default'],
    backgroundColor: colors['--surface-default'],
  },
  hint: {
    marginBlock: spacing['--space-3'],
    fontSize: text['--text-ui-size'],
    color: colors['--foreground-muted'],
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: spacing['--space-6'],
    marginTop: spacing['--space-6'],
  },
  section: {
    minWidth: 0,
  },
  sectionTitle: {
    margin: 0,
    marginBottom: spacing['--space-1-5'],
    fontSize: text['--text-heading-size'],
    fontWeight: text['--text-heading-weight'],
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
  },
  link: {
    display: 'block',
    paddingBlock: spacing['--space-0-5'],
    paddingInline: spacing['--space-1-5'],
    marginInline: `calc(-1 * ${spacing['--space-1-5']})`,
    borderRadius: radii['--radius-sm'],
    fontSize: text['--text-ui-size'],
    color: colors['--foreground-subtle'],
    textDecoration: 'none',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, '@media (hover: hover)': colors['--surface-hover'] },
    },
  },
})

const surfaces = stylex.create({
  background: { backgroundColor: colors['--background'] },
  subtle: { backgroundColor: colors['--background-subtle'] },
  surface: { backgroundColor: colors['--surface-default'] },
})
