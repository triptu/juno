import * as stylex from '@stylexjs/stylex'
import { chatCopy } from '@juno/agent-contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Illustration, Text } from '@juno/ui'

export interface NoProviderProps {
  /** Opens Settings › Juno at its provider section. */
  readonly onAddProvider: () => void
}

/**
 * The Juno tab and panel with no model provider set up (SPEC 13.10): the
 * agent does not run, so there is no chat yet, only one calm way to set a
 * provider up. Nothing here is an error.
 */
export function NoProvider({ onAddProvider }: NoProviderProps) {
  const copy = chatCopy.providers
  return (
    <div data-juno-no-provider="" {...stylex.props(styles.root)}>
      <Illustration name="juno" size="figure" />
      <Text variant="display" tone="default" as="h1">
        {copy.noneTitle}
      </Text>
      <Text variant="bodySmall" tone="subtle" as="p" sx={styles.body}>
        {copy.noneBody}
      </Text>
      <Button variant="primary" size="sm" onClick={onAddProvider}>
        {copy.add}
      </Button>
    </div>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: `calc(${spacing['--space-4']} + ${spacing['--space-0-5']})`,
    paddingTop: spacing['--space-10'],
    userSelect: 'none',
  },
  body: {
    maxWidth: '520px',
    textWrap: 'pretty',
  },
})
