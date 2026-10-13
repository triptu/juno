import { Text } from '@juno/ui'

export interface AppInfoViewProps {
  /** One line, for example "Juno 0.1.0 on darwin, Electron 44.7.0". */
  readonly line: string
  /** Just the line, for a diagnostics block. Default: the app name as a page title over the line. */
  readonly compact?: boolean
}

/** The app name as the page title with one line of build information under it. */
export function AppInfoView({ line, compact = false }: AppInfoViewProps) {
  return (
    <>
      {compact ? null : (
        <Text variant="pageTitle" tone="default">
          Juno
        </Text>
      )}
      <Text variant="meta" tone="muted" numeric as="p">
        {line}
      </Text>
    </>
  )
}
