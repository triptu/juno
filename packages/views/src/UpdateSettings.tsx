import { Button, Checkbox, Text } from '@juno/ui'

export interface UpdateSettingsProps {
  readonly available: boolean
  readonly enabled: boolean
  readonly version: string | null
  readonly onChange: (enabled: boolean) => void
  readonly onRestart: () => void
}

/** Background updates have no progress UI or dialogs. Only a downloaded update needs attention. */
export function UpdateSettings({ available, enabled, version, onChange, onRestart }: UpdateSettingsProps) {
  return <>
    <Checkbox label="Download updates automatically" checked={enabled} disabled={!available} onChange={(event) => onChange(event.currentTarget.checked)} />
    {version === null ? null : <Text variant="meta" tone="muted" as="p">
      Juno {version} is ready. <Button variant="outline" size="sm" onClick={onRestart}>Restart to update</Button>
    </Text>}
  </>
}
