import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, isWindows, Text } from '@juno/ui'
import { SignInArt } from './SignInArt'
import { SignInPage } from './SignInPage'
import { menuKeys } from './keys'

export interface SignInViewProps {
  /** `first-run` has never signed in; `expired` had a session Slack no longer accepts. */
  readonly mode: 'first-run' | 'expired'
  /** The Slack app's session is being read. */
  readonly busy?: 'import'
  /** One short sentence about the last failed attempt. */
  readonly error?: string
  /** The failure has a report: a quiet "Copy details" button puts it on the clipboard. */
  readonly onCopyDetails?: () => void
  readonly onImport: () => void
  /** The theme and accent controls (`AppearanceSettings` with `layout="bar"`), centred at the foot of the window. */
  readonly footer?: ReactNode
}

/** The page's copy (SPEC section 4, "Sign-in"). This is the one surface where Juno speaks in the first person. */
export const signInCopy = {
  title: "Hi, I'm Juno",
  pitch: 'I make Slack sane. Every thread, channel and DM becomes a topic, all in one quiet list.',
  highlights: [
    { label: 'Home', line: 'I show you at most three things that want you.' },
    { label: 'Resolve topics', line: 'One click clears a topic from the list, with undo.' },
    { label: 'Smart notifications', line: 'Tell me what matters. I hold the rest inside your hours.' },
    { label: 'Fast', line: `Every action answers at once and has a key. ${menuKeys('palette.toggle')} finds anything.` },
  ],
  expiredTitle: 'Slack signed you out',
  expiredBody: 'The Slack app’s session ended. Open Slack, sign in there, then try again. Your topics and settings are kept.',
  button: "Use the Slack app's session",
  // Windows asks for nothing: the Slack app's session is read without a prompt (decision D5).
  note: isWindows ? undefined : 'macOS will ask for your password once, so I can read the Slack app’s session.',
  busy: 'Reading the Slack app’s session',
  copyDetails: 'Copy details',
} as const

/**
 * The page shown when there is no usable session, centred on the window:
 * the mark, the serif title, the pitch and four highlights, one primary
 * action that reads the installed Slack app's session, a quiet line for
 * what went wrong, and the appearance controls at the foot. Tide pebbles
 * drift off both edges behind it (`SignInArt`). Signed out, the
 * highlights go: the owner knows Juno and needs only the next step.
 */
export function SignInView({ mode, busy, error, onCopyDetails, onImport, footer }: SignInViewProps) {
  const waiting = busy !== undefined
  const expired = mode === 'expired'
  const status = waiting
    ? { text: signInCopy.busy, tone: 'muted' as const }
    : error === undefined
      ? undefined
      : { text: error, tone: 'danger' as const }
  return (
    <div {...stylex.props(styles.root)}>
      <SignInArt />
      <SignInPage
        titleId="sign-in-title"
        title={expired ? signInCopy.expiredTitle : signInCopy.title}
        body={expired ? signInCopy.expiredBody : signInCopy.pitch}
        align="center"
        busy={waiting}
        {...(status === undefined ? {} : { status })}
        {...(status?.tone === 'danger' && onCopyDetails !== undefined
          ? {
              statusAction: (
                <Button variant="ghost" size="xs" tone="subtle" onClick={onCopyDetails}>
                  {signInCopy.copyDetails}
                </Button>
              ),
            }
          : {})}
      >
        {expired ? null : (
          <dl {...stylex.props(styles.highlights)}>
            {signInCopy.highlights.map(({ label, line }) => (
              <div key={label} {...stylex.props(styles.highlight)}>
                <Text variant="ui" tone="default" weight="medium" as="dt" sx={styles.label}>
                  {label}
                </Text>
                <Text variant="ui" tone="subtle" as="dd" sx={styles.line}>
                  {line}
                </Text>
              </div>
            ))}
          </dl>
        )}
        <div {...stylex.props(styles.actions)}>
          <Button variant="primary" size="2xl" onClick={onImport} disabled={waiting}>
            {signInCopy.button}
          </Button>
          {signInCopy.note === undefined ? null : (
            <Text variant="meta" tone="muted" as="p">
              {signInCopy.note}
            </Text>
          )}
        </div>
      </SignInPage>
      {footer === undefined ? null : <div {...stylex.props(styles.footer)}>{footer}</div>}
    </div>
  )
}

const styles = stylex.create({
  // Fills the page under the drag strip and scrolls on a short window. Not
  // positioned, so the art is placed against the whole window.
  root: {
    flexGrow: 1,
    alignSelf: 'stretch',
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  // Two columns: the labels end on one edge, the lines start beside it.
  highlights: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, auto)',
    justifyContent: 'center',
    rowGap: spacing['--space-3'],
    margin: 0,
  },
  highlight: {
    display: 'contents',
  },
  label: {
    textAlign: 'end',
    paddingInlineEnd: spacing['--space-4'],
  },
  line: {
    margin: 0,
    textAlign: 'start',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: spacing['--space-2'],
  },
  // Above the art, at the foot of the window.
  footer: {
    position: 'relative',
    flexShrink: 0,
    paddingTop: spacing['--space-6'],
    paddingBottom: spacing['--space-8'],
  },
})
