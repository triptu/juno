import { Text } from '@juno/ui'

export interface AppInfoViewProps {
  /** One line, for example "Juno 0.1.0 on darwin, Electron 44.7.0". */
  readonly line: string
}

/** The app name as the page title with one line of build information under it. */
export function AppInfoView({ line }: AppInfoViewProps) {
  return (
    <>
      <Text variant="pageTitle" tone="default">
        Juno
      </Text>
      <Text variant="meta" tone="muted" numeric as="p">
        {line}
      </Text>
    </>
  )
}
