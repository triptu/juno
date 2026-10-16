import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Text } from '@juno/ui'

export interface SessionViewProps {
  readonly teamName: string
  /** The user's handle, for example "tushar". */
  readonly userName: string
  /** Enterprise Grid organisation, when there is one. */
  readonly enterpriseName?: string
  /** True while the sign-out runs. */
  readonly signingOut?: boolean
  readonly onSignOut: () => void
}

/** One quiet line saying which workspace is connected, and the way out. */
export function SessionView({ teamName, userName, enterpriseName, signingOut = false, onSignOut }: SessionViewProps) {
  const where = enterpriseName === undefined ? teamName : `${teamName} (${enterpriseName})`
  return (
    <section {...stylex.props(styles.section)} aria-label="Session">
      <Text variant="meta" tone="muted" as="p" role="status" aria-label="Session status">
        Signed in to {where} as {userName}
      </Text>
      {/* Pulled back by its padding and border, so "Sign out" starts on the line's edge, at the menu's inset. */}
      <span {...stylex.props(styles.signOut)}>
        <Button variant="ghost" size="sm" tone="muted" onClick={onSignOut} disabled={signingOut}>
          Sign out
        </Button>
      </span>
    </section>
  )
}

const styles = stylex.create({
  // The line, then Sign out under it, both at the start.
  section: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-1'],
  },
  signOut: {
    display: 'inline-flex',
    marginInlineStart: `calc(-1 * (${spacing['--space-2-5']} + 1px))`, // tokens-allow: The button's padding and its 1px border.
  },
})
