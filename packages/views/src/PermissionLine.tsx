import { BellSlash } from '@phosphor-icons/react/dist/icons/BellSlash'
import type { NotificationPermission } from '@juno/contract'
import { Button, Icon, ListRow, Surface, Text } from '@juno/ui'

/** While macOS does not let Juno notify: one line with the way to turn it on. Nothing otherwise. */
export function PermissionLine({ permission, onOpenSettings, onAllow }: { readonly permission: NotificationPermission; readonly onOpenSettings: () => void; readonly onAllow: () => void }) {
  if (permission.authorization !== 'denied' && permission.authorization !== 'notDetermined' && permission.badges !== 'disabled') return null
  return (
    <Surface kind="group" role="status" aria-label="Notification permission">
      <ListRow
        divider={false}
        leading={<Icon icon={BellSlash} size={15} />}
        trailing={
          permission.authorization !== 'notDetermined' ? (
            <Button variant="secondary" size="sm" onClick={onOpenSettings}>
              Open Notification Settings
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={onAllow}>
              Allow notifications
            </Button>
          )
        }
      >
        <Text variant="ui">{permission.authorization === 'allowed' && permission.badges === 'disabled' ? 'Dock badges are off for Juno.' : "macOS is not showing Juno's notifications."}</Text>
      </ListRow>
    </Surface>
  )
}
