import * as stylex from '@stylexjs/stylex'
import type { Ref } from 'react'
import type { Hours, NotificationPermission } from '@juno/contract'
import { colors, layout, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, DayToggles, ListRow, Section, Select, Surface, Text } from '@juno/ui'
import { hourLabel } from './time'

/**
 * The plain parts of Settings › Notifications (SPEC 14, inventory 13): the
 * two sets of hours with Slack's schedule line, How Auto decides, Today's
 * line and the test notification.
 */

export type HoursKind = 'notifications' | 'presence'

/** Slack's own schedule, which Juno writes from the notification hours. */
export interface SlackScheduleState {
  /** Changed in Slack after Juno wrote it: Juno leaves it until Use Juno's hours. */
  readonly changedInSlack: boolean
  /** The hours are still the defaults on this install, so nothing is written yet. */
  readonly waitingForHours: boolean
}

export interface HoursProps {
  readonly notificationHours: Hours
  readonly presenceHours: Hours
  readonly onDayChange: (which: HoursKind, day: Hours['days'][number], enabled: boolean) => void
  readonly onHoursChange: (which: HoursKind, hours: Partial<Hours>) => void
  /** Slack's own schedule; undefined until the engine answers. */
  readonly slackSchedule: SlackScheduleState | undefined
  /** Use Juno's hours, while the schedule was changed in Slack. */
  readonly onUseJunoHours: () => void
}

const HALF_HOUR = 30
const times = Array.from({ length: (24 * 60) / HALF_HOUR }, (_, index) => {
  const minutes = index * HALF_HOUR
  return { value: String(minutes), label: hourLabel(minutes) }
})

/** Notification hours, then Active in Slack, each its own section. */
export function HoursSections({ notificationHours, presenceHours, onHoursChange, onDayChange, slackSchedule, onUseJunoHours, hoursRef }: HoursProps & { readonly hoursRef: Ref<HTMLElement> }) {
  return (
    <>
      <Section headingRef={hoursRef} heading="Notification hours" sub="Outside these hours your Mac doesn't notify. Slack pauses at the same times, so your phone stays quiet too.">
          <Surface kind="group">
            <HoursRow which="notifications" title="Notification hours" hours={notificationHours} onChange={onHoursChange} onDayChange={onDayChange} />
            <SlackLine schedule={slackSchedule} onUseJunoHours={onUseJunoHours} />
          </Surface>
        </Section>
      <Section heading="Active in Slack" sub="Outside these hours you show as away.">
        <Surface kind="group">
          <HoursRow which="presence" title="Active in Slack" hours={presenceHours} onChange={onHoursChange} onDayChange={onDayChange} />
          <div {...stylex.props(styles.note)}>
            <Text variant="meta" tone="muted" as="p">
              Juno switches your status while it's open. If it's closed when your active hours start, you stay away until you open it.
            </Text>
          </div>
        </Surface>
      </Section>
    </>
  )
}

/** The days on the left, the times on the right. The section's heading names the row. */
function HoursRow({ which, title, hours, onChange, onDayChange }: { readonly which: HoursKind; readonly title: string; readonly hours: Hours; readonly onChange: HoursProps['onHoursChange']; readonly onDayChange: HoursProps['onDayChange'] }) {
  // The controls keep their short names: "Notifications from", "Active in Slack days".
  const name = which === 'notifications' ? 'Notifications' : title
  const set = (patch: Partial<Hours>) => onChange(which, patch)
  const from = String(Math.floor(hours.from / HALF_HOUR) * HALF_HOUR)
  const to = String(Math.floor(hours.to / HALF_HOUR) * HALF_HOUR)
  return (
    <div role="group" aria-label={title} {...stylex.props(styles.hoursRow)}>
      <DayToggles days={hours.days} label={`${name} days`} onChange={(day, enabled) => onDayChange(which, day, enabled)} />
      {/* The times stay together when the row wraps. */}
      <span {...stylex.props(styles.times)}>
        <Select size={32} label={`${name} from`} options={times} value={from} onChange={(event) => set({ from: Number(event.currentTarget.value) })} />
        <Text variant="ui" tone="muted">
          to
        </Text>
        <Select size={32} label={`${name} to`} options={times} value={to} onChange={(event) => set({ to: Number(event.currentTarget.value) })} />
      </span>
    </div>
  )
}

/** Under the notification hours, only while there is something to say about Slack's schedule. The owner renders the page once the schedule is known, so it never appears late. */
function SlackLine({ schedule, onUseJunoHours }: { readonly schedule: SlackScheduleState | undefined; readonly onUseJunoHours: () => void }) {
  if (schedule?.waitingForHours !== true && schedule?.changedInSlack !== true) return null
  return (
    <div aria-live="polite" {...stylex.props(styles.slackLine)}>
      {schedule.waitingForHours ? (
        <Text variant="meta" tone="muted">
          Slack's schedule changes once you set your notification hours.
        </Text>
      ) : null}
      {schedule.changedInSlack ? (
        <>
          <Text variant="meta" tone="muted">
            Your schedule was changed in Slack. Juno leaves it until you change your hours here.
          </Text>
          <Button variant="secondary" size="sm" onClick={onUseJunoHours}>
            Use Juno's hours
          </Button>
        </>
      ) : null}
    </div>
  )
}

function Check({ title, words }: { readonly title: string; readonly words: string }) {
  return (
    <li>
      <Text variant="ui" weight="semibold" as="span">
        {title}
      </Text>{' '}
      {words}
    </li>
  )
}

/** How Auto decides: the four checks in plain words. How Auto decides… and Notification settings open the page here. */
export function HowAutoDecides({ headingRef }: { readonly headingRef: Ref<HTMLElement> }) {
  return (
    <Section headingRef={headingRef} heading="How Auto decides">
      <div {...stylex.props(styles.howAuto)}>
        <Text variant="ui" tone="subtle" as="div">
          <p {...stylex.props(styles.howLead)}>For everything on Auto, Juno checks in this order:</p>
          <ol {...stylex.props(styles.howList)}>
            <Check title="Closers." words={'"thanks", "ok" and the like don\'t notify.'} />
            <Check title="Messages to someone else." words="A message that names someone else and not you doesn't notify." />
            <Check title="Conversations you're in." words="If you wrote in the last 10 minutes, replies notify." />
            <Check
              title="Juno reads it."
              words="If it clearly falls under your instructions, Juno does what they say. Otherwise, questions to you, answers to your questions, follow-ups you haven't answered, decisions in threads you started and serious problems notify. Greetings, updates and chatter stay in Juno."
            />
          </ol>
        </Text>
      </div>
    </Section>
  )
}

function count(n: number) {
  return (
    <Text variant="body" tone="inherit" weight="semibold" numeric as="span">
      {n}
    </Text>
  )
}

/** Today: the counts, and Details while there is anything to list. */
export function TodaySection({ notifiedToday, stayedToday, detailsOpen, onDetails }: { readonly notifiedToday: number; readonly stayedToday: number; readonly detailsOpen: boolean; readonly onDetails: () => void }) {
  return (
    <Section heading="Today">
      <div {...stylex.props(styles.todayLine)}>
        <Text variant="body" tone="subtle">
          {count(notifiedToday)} notified you, {count(stayedToday)} stayed in Juno.
        </Text>
        {notifiedToday + stayedToday === 0 ? null : (
          <Button variant="ghost" size="sm" tone="subtle" aria-haspopup="dialog" expanded={detailsOpen} onClick={onDetails}>
            Details
          </Button>
        )}
      </div>
    </Section>
  )
}

/** Send test notification. When Juno cannot tell whether macOS lets it notify, Open Notification Settings sits beside it. */
export function TestSection({ permission, onSendTest, onOpenSettings }: { readonly permission: NotificationPermission; readonly onSendTest: () => void; readonly onOpenSettings: () => void }) {
  return (
    <Section heading="Test">
      <Surface kind="group">
        <ListRow
          aria-label="Test notification"
          divider={false}
          trailing={
            <span {...stylex.props(styles.controls)}>
              {permission.authorization === 'unknown' ? (
                <Button variant="ghost" size="sm" tone="subtle" onClick={onOpenSettings}>
                  Open Notification Settings
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={onSendTest}>
                Send test notification
              </Button>
            </span>
          }
        >
          <span {...stylex.props(styles.label)}>
            <Text variant="ui" weight="medium">
              Test notification
            </Text>
            <Text variant="meta" tone="muted">
              If none appears, Focus or Do Not Disturb may be on.
            </Text>
          </span>
        </ListRow>
      </Surface>
    </Section>
  )
}


const styles = stylex.create({
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    width: layout['--settings-label-width'],
    maxWidth: '100%',
    minWidth: 0,
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
  hoursRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing['--space-3'],
    rowGap: spacing['--space-2'],
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-3-5'],
  },
  times: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
  },
  note: {
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: colors['--border-subtle'],
    paddingBlockStart: spacing['--space-2-5'],
    paddingBlockEnd: spacing['--space-3'],
    paddingInline: spacing['--space-3-5'],
  },
  // Under the hours row, at its start.
  slackLine: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing['--space-2'],
    rowGap: spacing['--space-1'],
    minHeight: sizes['--control-28'],
    paddingInline: spacing['--space-3-5'],
    paddingBottom: spacing['--space-2'],
  },
  howAuto: {
    paddingBlock: spacing['--space-3'],
    paddingInline: spacing['--space-3-5'],
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--surface-hover'],
  },
  howLead: {
    margin: 0,
  },
  howList: {
    margin: 0,
    marginTop: spacing['--space-1-5'],
    paddingInlineStart: spacing['--space-5'],
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
  },
  todayLine: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    minHeight: sizes['--control-28'],
  },
})
