import * as stylex from '@stylexjs/stylex'
import { chatCopy } from '@juno/agent-contract'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Illustration, Text } from '@juno/ui'

export interface NoProviderProps {
  /** Opens Settings › Juno at its provider section. */
  readonly onAddProvider: () => void
  /** Under the Juno header: `page` in the Juno tab's 720px column, `panel` in the panel. Default: no column, for a frame that places it. */
  readonly column?: 'page' | 'panel'
}

/**
 * The Juno tab and panel with no model provider set up (SPEC 13.10): the
 * agent does not run, so there is no chat yet, only one calm way to set a
 * provider up. Nothing here is an error.
 */
export function NoProvider({ onAddProvider, column }: NoProviderProps) {
  const copy = chatCopy.providers
  return (
    <div data-juno-no-provider="" {...stylex.props(styles.root, column !== undefined && styles.underHeader, column === 'page' && styles.page, column === 'panel' && styles.panel)}>
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
  // Below the header's islands, as the chat's first row is.
  underHeader: {
    flexGrow: 1,
    paddingTop: `calc(${layout['--header-inset']} + ${spacing['--space-10']})`,
    boxSizing: 'border-box',
  },
  page: {
    width: '100%',
    maxWidth: layout['--page-width'],
    marginInline: 'auto',
    paddingInline: spacing['--space-8'],
  },
  panel: {
    paddingInline: spacing['--space-4'],
  },
  body: {
    maxWidth: layout['--chat-empty-width'],
    textWrap: 'pretty',
  },
})
