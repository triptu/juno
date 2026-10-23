import { Checkbox, ListRow, Section, Surface } from '@juno/ui'
import type { AlwaysNotify, AlwaysNotifyKey } from './notificationRules'

export interface AlwaysNotifySectionProps {
  readonly alwaysNotify: AlwaysNotify
  readonly onAlwaysNotifyChange: (key: AlwaysNotifyKey, enabled: boolean) => void
}

const switches: ReadonlyArray<{ readonly key: AlwaysNotifyKey; readonly label: string; readonly description?: string }> = [
  { key: 'dms', label: 'Direct messages' },
  { key: 'groupDms', label: 'Group DMs' },
  { key: 'mentions', label: 'Mentions', description: "You, groups you're in, @here and @channel" },
  { key: 'startedThreads', label: 'Threads you started' },
  { key: 'followedThreads', label: 'Threads you follow' },
]

/**
 * Settings › Notifications › Always notify (SPEC 14, inventory 13): five
 * switches that notify inside the hours without Juno reading the message.
 * While Threads you follow is on, Threads you started shows on and dimmed,
 * since every thread you started is one you follow.
 */
export function AlwaysNotifySection({ alwaysNotify, onAlwaysNotifyChange }: AlwaysNotifySectionProps) {
  return (
    <Section heading="Always notify" sub="These notify inside your hours, whatever they say. Turn them all on to be notified the way Slack does by default.">
      <Surface kind="group">
        {switches.map(({ key, label, description }, index) => {
          const included = key === 'startedThreads' && alwaysNotify.followedThreads
          const shown = included ? 'Included in Threads you follow.' : description
          return (
            <ListRow key={key} divider={index < switches.length - 1}>
              <Checkbox
                role="switch"
                size="lg"
                label={label}
                checked={alwaysNotify[key] || included}
                disabled={included}
                onChange={(event) => onAlwaysNotifyChange(key, event.currentTarget.checked)}
                {...(shown === undefined ? {} : { description: shown })}
              />
            </ListRow>
          )
        })}
      </Surface>
    </Section>
  )
}
