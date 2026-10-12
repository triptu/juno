import * as stylex from '@stylexjs/stylex'
import { useAtom, useAtomValue } from '@effect/atom-react'
import { Moon, Sun } from 'lucide-react'
import { useLayoutEffect } from 'react'
import { appInfoAtom, persistTheme, themeAtom } from '@juno/state'
import { Button, PageTitle } from '@juno/ui'
import { colors, layout, spacing, type } from '@juno/tokens/tokens.stylex'
import { EngineStatus } from './containers/EngineStatus'
import { applyTheme } from './theme'

/**
 * The app shell. It paints with no data: everything below the title bar that
 * needs the engine renders its own waiting state. Tabs will live inside
 * `<main>` as `<Activity>` children (performance 4.3); nothing above them may
 * change on a tick.
 */
export function App() {
  const [theme, setTheme] = useAtom(themeAtom)
  const appInfo = useAtomValue(appInfoAtom)

  useLayoutEffect(() => applyTheme(theme), [theme])

  const nextTheme = theme === 'light' ? 'dark' : 'light'

  return (
    <div {...stylex.props(styles.shell)}>
      <header {...stylex.props(styles.titlebar)} aria-label="Window title bar" />
      <main {...stylex.props(styles.page)}>
        <PageTitle>Juno</PageTitle>
        <p {...stylex.props(styles.meta)}>
          {appInfo._tag === 'Success'
            ? `${appInfo.value.name} ${appInfo.value.version} on ${appInfo.value.platform}, Electron ${appInfo.value.electron}`
            : appInfo._tag === 'Failure'
              ? 'Could not read app info'
              : 'Loading app info'}
        </p>
        <EngineStatus />
        <div {...stylex.props(styles.actions)}>
          <Button
            onClick={() => {
              setTheme(nextTheme)
              persistTheme(nextTheme)
            }}
            aria-pressed={theme === 'dark'}
          >
            {theme === 'light' ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
            {`Use ${nextTheme} theme`}
          </Button>
          <Button variant="primary">Primary action</Button>
          <Button disabled>Disabled</Button>
        </div>
      </main>
    </div>
  )
}

const styles = stylex.create({
  shell: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: colors['--background'],
    color: colors['--foreground-default'],
  },
  titlebar: {
    flexShrink: 0,
    height: layout['--titlebar-height'],
    // The strip is draggable; interactive children must set no-drag.
    WebkitAppRegion: 'drag',
    userSelect: 'none',
  },
  page: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-4'],
    paddingInline: spacing['--space-8'],
    paddingBlock: spacing['--space-4'],
    backgroundColor: colors['--background'],
  },
  meta: {
    margin: 0,
    fontSize: type['--text-sm'],
    color: colors['--foreground-muted'],
    fontVariantNumeric: 'tabular-nums',
  },
  actions: {
    display: 'flex',
    gap: spacing['--space-2'],
  },
})
