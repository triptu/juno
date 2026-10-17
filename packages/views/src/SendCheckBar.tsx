import * as stylex from '@stylexjs/stylex'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { TextAa } from '@phosphor-icons/react/dist/icons/TextAa'
import { colors, radii, spacing, weights } from '@juno/tokens/tokens.stylex'
import { Button, Icon, Text } from '@juno/ui'

/** What a check on send found (spec section 8). */
export type SendCheckFinding =
  /** The draft in a Main reads like a reply to this topic. */
  | { readonly kind: 'route'; readonly title: string }
  /** Minimal fixes ("recieve → receive"), a note about a long sentence, or both. */
  | { readonly kind: 'clarity'; readonly fixes: ReadonlyArray<string>; readonly note?: string }

export interface SendCheckBarProps {
  readonly finding: SendCheckFinding
  /** Post in thread, Fix and send, or Send (when the only note is a long sentence). Enter takes it too. */
  readonly onPrimary: () => void
  /** Send to Main, Send as is, or Keep editing. */
  readonly onSecondary: () => void
}

/** The two choices a finding offers, the first one Enter's. */
export function sendCheckLabels(finding: SendCheckFinding): readonly [primary: string, secondary: string] {
  if (finding.kind === 'route') return ['Post in thread', 'Send to Main']
  return finding.fixes.length > 0 ? ['Fix and send', 'Send as is'] : ['Send', 'Keep editing']
}

/**
 * The bar inside the composer when a check on send finds something
 * (inventory 7.3): what was found and two choices.
 * Enter takes the first and Esc returns to editing; the composer owns the
 * keys, the bar only draws.
 */
export function SendCheckBar({ finding, onPrimary, onSecondary }: SendCheckBarProps) {
  const [primary, secondary] = sendCheckLabels(finding)
  return (
    <div data-send-check={finding.kind} {...stylex.props(styles.bar)}>
      <span aria-hidden {...stylex.props(styles.icon)}>
        <Icon icon={finding.kind === 'route' ? ChatsCircle : TextAa} size={14} />
      </span>
      <Text variant="ui" tone="default" role="status" sx={styles.text}>
        {finding.kind === 'route' ? (
          <>
            Looks like a reply to <strong {...stylex.props(styles.strong)}>{finding.title}</strong>
          </>
        ) : finding.fixes.length === 0 ? (
          `Reads a bit long. ${finding.note ?? ''}`
        ) : (
          <>
            {finding.fixes.length === 1 ? '1 fix' : `${finding.fixes.length} fixes`}: <strong {...stylex.props(styles.strong)}>{finding.fixes.join(', ')}</strong>
            {finding.note === undefined ? null : <span {...stylex.props(styles.note)}> · {finding.note}</span>}
          </>
        )}
      </Text>
      <span {...stylex.props(styles.choices)}>
        <Button variant="raised" size="sm" kbd="↵" onClick={onPrimary}>
          {primary}
        </Button>
        <Button variant="ghost" size="sm" tone="subtle" onClick={onSecondary}>
          {secondary}
        </Button>
      </span>
    </div>
  )
}

/**
 * The narrowest the finding may get beside the choices. Below it (a narrow
 * topic column) the choices move to a line of their own, at the end, rather
 * than squeezing the text to a word per line.
 */
const TEXT_MIN_WIDTH = 'min(200px, 100%)' // tokens-allow: the finding's narrowest beside its choices

const styles = stylex.create({
  bar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    marginTop: spacing['--space-1-5'],
    marginInline: spacing['--space-1-5'],
    paddingBlock: spacing['--space-2'],
    paddingInlineStart: spacing['--space-3'],
    paddingInlineEnd: spacing['--space-2'],
    // The composer's one inset (6px, as the chips and the attach and send
    // buttons), and concentric with its 20px corners.
    borderRadius: radii['--radius-2xl'],
    backgroundColor: colors['--surface-hover'],
  },
  icon: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-subtle'],
  },
  text: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: TEXT_MIN_WIDTH,
  },
  strong: {
    fontWeight: weights['--weight-semibold'],
  },
  note: {
    color: colors['--foreground-muted'],
  },
  // At the end of the text's line, or of a line of their own. They wrap only in a field too narrow for both.
  choices: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing['--space-2'],
    marginInlineStart: 'auto',
  },
})
