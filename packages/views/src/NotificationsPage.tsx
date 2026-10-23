import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, useState } from 'react'
import type { Hours, NotificationPermission, PickConversation } from '@juno/contract'
import { colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, DayToggles, ListRow, Page, PageHeader, Section, Select, Surface, Text } from '@juno/ui'
import { AlwaysNotifySection } from './AlwaysNotifySection'
import { HuddleRingSection, type HuddleRingProps } from './HuddleRingSection'
import { InstructionsSection, type InstructionsSectionProps } from './InstructionsSection'
import { NotificationDetails, type DetailsFilter, type ProposedInstruction, type WhyActions } from './NotificationDetails'
import type { AlwaysNotify, AlwaysNotifyKey, Decision, LevelTag } from './notificationRules'
import { NotifyLevelsSection, type LevelPicker, type ListedLevel } from './NotifyLevelsSection'
import { PermissionLine } from './PermissionLine'
import { SheetLayer } from './SheetLayer'
import { hourLabel } from './time'

export type HoursKind = 'notifications' | 'presence'

/** Slack's own schedule, which Juno writes from the notification hours. */
export interface SlackScheduleState {
  /** Changed in Slack after Juno wrote it: Juno leaves it until Use Juno's hours. */
  readonly changedInSlack: boolean
  /** The hours are still the defaults on this install, so nothing is written yet. */
  readonly waitingForHours: boolean
}

/** A part of the page another place opens it at. */
export type NotificationsAnchor = 'hours' | 'always-notify' | 'instructions' | 'levels' | 'how-auto'

export interface NotificationsPageProps extends HuddleRingProps, Omit<InstructionsSectionProps, 'aiAssist' | 'initialDirection'>, WhyActions {
  readonly notificationHours: Hours
  readonly presenceHours: Hours
  readonly onDayChange: (which: HoursKind, day: Hours['days'][number], enabled: boolean) => void
  readonly onHoursChange: (which: HoursKind, hours: Partial<Hours>) => void
  /** Slack's own schedule; undefined until the engine answers. */
  readonly slackSchedule: SlackScheduleState | undefined
  /** Use Juno's hours, while the schedule was changed in Slack. */
  readonly onUseJunoHours: () => void
  /** Off: DMs and mentions notify, the rest stays; the instructions are not read. */
  readonly aiAssist: boolean
  readonly alwaysNotify: AlwaysNotify
  readonly onAlwaysNotifyChange: (key: AlwaysNotifyKey, enabled: boolean) => void
  readonly always: ReadonlyArray<LevelTag>
  readonly never: ReadonlyArray<LevelTag>
  /** Back to Auto. */
  readonly onRemoveLevel: (tag: LevelTag) => void
  readonly picker: LevelPicker
  readonly onPickLevel: (level: ListedLevel, conversation: PickConversation) => void
  readonly onOpenIgnored: () => void
  /** Today's counts, for the line. */
  readonly notifiedToday: number
  readonly stayedToday: number
  /** Today's decisions, newest first, for Details; undefined while they load. */
  readonly decisions: ReadonlyArray<Decision> | undefined
  /** Details opened or closed: the owner reads the decisions only while it is open. */
  readonly onDetailsOpenChange?: (open: boolean) => void
  readonly proposals: ReadonlyMap<string, ProposedInstruction>
  readonly alwaysFor: ReadonlyMap<string, string>
  /** Whether macOS lets Juno notify. Denied or not determined puts a line at the top of the page. */
  readonly permission: NotificationPermission
  /** Send test notification. */
  readonly onSendTest: () => void
  /** Open Notification Settings: System Settings at Juno's entry. */
  readonly onOpenSettings: () => void
  /** Allow notifications, while macOS has not asked yet: its prompt. */
  readonly onAllow: () => void
  /**
   * Scrolls this part into view and focuses its heading, once for each new
   * `anchorKey`: How Auto decides… and Notification settings, Edit instructions.
   */
  readonly anchor?: NotificationsAnchor
  readonly anchorKey?: number
  /** Details starts open (fixtures), on this filter and with this row's why open. */
  readonly details?: {
    readonly filter?: DetailsFilter
    readonly open?: string
  }
  /** The add row's direction to start with (fixtures). */
  readonly initialDirection?: InstructionsSectionProps['initialDirection']
  /** Which Add… starts open (fixtures). */
  readonly initialPicker?: ListedLevel
}

const HALF_HOUR = 30
const times = Array.from({ length: (24 * 60) / HALF_HOUR }, (_, index) => {
  const minutes = index * HALF_HOUR
  return { value: String(minutes), label: hourLabel(minutes) }
})

/**
 * Settings › Notifications (SPEC 14, inventory 13): the two sets of hours
 * with Slack's schedule line, the Always notify switches, the owner's
 * instructions, what is set to Always and Never, how Auto decides, today's
 * line with Details, Ring for huddles and a test notification. While macOS
 * does not let Juno notify, a line at the top says so, with the way to
 * turn it on.
 */
export function NotificationsPage(props: NotificationsPageProps) {
  const {
    notificationHours,
    presenceHours,
    onHoursChange,
    onDayChange,
    slackSchedule,
    onUseJunoHours,
    aiAssist,
    alwaysNotify,
    onAlwaysNotifyChange,
    always,
    never,
    onRemoveLevel,
    picker,
    onPickLevel,
    onOpenIgnored,
    notifiedToday,
    stayedToday,
    decisions,
    onDetailsOpenChange,
    permission,
    onSendTest,
    onOpenSettings,
    onAllow,
    huddleRing,
    onHuddleRingChange,
    anchor,
    anchorKey,
    details,
    initialDirection,
    initialPicker,
  } = props
  const anchors = useRef<Partial<Record<NotificationsAnchor, HTMLDivElement | null>>>({})
  const [detailsOpen, setDetailsShown] = useState(details !== undefined)
  const setDetailsOpen = (open: boolean) => {
    setDetailsShown(open)
    onDetailsOpenChange?.(open)
  }
  // Before paint, so the page opens already at the part asked for.
  useLayoutEffect(() => {
    if (anchor === undefined) return
    const part = anchors.current[anchor]
    // The section's heading: the first line of its head.
    const heading = part?.querySelector<HTMLElement>('section > div > :first-child') ?? part
    if (heading === null || heading === undefined) return
    heading.scrollIntoView({ block: 'start', behavior: 'instant' })
    heading.tabIndex = -1
    // Focus for screen readers and the next Tab, with no ring: the owner did not press a key here.
    heading.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
  }, [anchor, anchorKey])
  return (
    <Page width="settings">
      <PageHeader title="Notifications" subtitle="Inside your notification hours, Juno notifies you about what needs you. Everything is in Juno whenever you open it." />

      <PermissionLine permission={permission} onOpenSettings={onOpenSettings} onAllow={onAllow} />

      <div ref={(element) => void (anchors.current.hours = element)} {...stylex.props(styles.anchor)}>
        <Section heading="Notification hours" sub="Outside these hours your Mac doesn't notify. Slack pauses at the same times, so your phone stays quiet too.">
          <Surface kind="group">
            <HoursRow which="notifications" title="Notification hours" hours={notificationHours} onChange={onHoursChange} onDayChange={onDayChange} />
            <SlackLine schedule={slackSchedule} onUseJunoHours={onUseJunoHours} />
          </Surface>
        </Section>
      </div>

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

      <div ref={(element) => void (anchors.current['always-notify'] = element)} {...stylex.props(styles.anchor)}>
        <AlwaysNotifySection alwaysNotify={alwaysNotify} onAlwaysNotifyChange={onAlwaysNotifyChange} />
      </div>

      <div ref={(element) => void (anchors.current.instructions = element)} data-anchor="instructions" {...stylex.props(styles.anchor)}>
        <InstructionsSection {...props} aiAssist={aiAssist} {...(initialDirection === undefined ? {} : { initialDirection })} />
      </div>

      <div ref={(element) => void (anchors.current.levels = element)} {...stylex.props(styles.anchor)}>
        <NotifyLevelsSection always={always} never={never} onRemove={onRemoveLevel} picker={picker} onPick={onPickLevel} onOpenIgnored={onOpenIgnored} {...(initialPicker === undefined ? {} : { initialPicker })} />
      </div>

      <div ref={(element) => void (anchors.current['how-auto'] = element)} data-anchor="how-auto" {...stylex.props(styles.anchor)}>
        <HowAutoDecides />
      </div>

      <Section heading="Today">
        <div {...stylex.props(styles.todayLine)}>
          <Text variant="body" tone="subtle">
            {notifiedToday === 0 ? (
              'Nothing has notified you today.'
            ) : (
              <>
                Today: {count(notifiedToday)} notified you, {count(stayedToday)} stayed in Juno.
              </>
            )}
          </Text>
          {notifiedToday + stayedToday === 0 ? null : (
            <Button variant="ghost" size="sm" tone="subtle" aria-haspopup="dialog" expanded={detailsOpen} onClick={() => setDetailsOpen(true)}>
              Details
            </Button>
          )}
        </div>
      </Section>

      <HuddleRingSection huddleRing={huddleRing} onHuddleRingChange={onHuddleRingChange} />

      <Section heading="Test">
        <TestRow permission={permission} onSendTest={onSendTest} onOpenSettings={onOpenSettings} />
      </Section>
      {detailsOpen ? (
        <SheetLayer onClose={() => setDetailsOpen(false)}>
          <NotificationDetails
            {...props}
            decisions={decisions}
            onClose={() => setDetailsOpen(false)}
            // The page's part opens under the sheet, so the sheet closes first.
            onSettings={() => {
              setDetailsOpen(false)
              props.onSettings()
            }}
            onEditInstructions={() => {
              setDetailsOpen(false)
              props.onEditInstructions()
            }}
            onChange={(decision) => {
              setDetailsOpen(false)
              props.onChange(decision)
            }}
            {...(details?.filter === undefined ? {} : { initialFilter: details.filter })}
            {...(details?.open === undefined ? {} : { initialOpen: details.open })}
          />
        </SheetLayer>
      ) : null}
    </Page>
  )
}

/** How Auto decides: the three checks in plain words. How Auto decides… and Notification settings open the page here. */
function HowAutoDecides() {
  const line = (title: string, words: string) => (
    <li>
      <Text variant="ui" weight="semibold" as="span">
        {title}
      </Text>{' '}
      {words}
    </li>
  )
  return (
    <Section heading="How Auto decides">
      <div {...stylex.props(styles.howAuto)}>
        <Text variant="ui" tone="subtle" as="div">
          <p {...stylex.props(styles.howLead)}>For everything on Auto, Juno checks in this order:</p>
          <ol {...stylex.props(styles.howList)}>
            {line('Closers.', '"thanks", "ok" and the like don\'t notify.')}
            {line("Conversations you're in.", 'If you wrote in the last 10 minutes, replies notify.')}
            {line(
              'Juno reads it.',
              "If it clearly falls under your instructions, Juno does what they say. Otherwise, asks, answers to your questions, follow-ups you haven't answered, decisions you should weigh in on and serious problems notify. Greetings, updates and chatter stay in Juno.",
            )}
          </ol>
        </Text>
      </div>
    </Section>
  )
}

/** Under the notification hours: what Juno is doing with Slack's schedule. Its height is kept when empty, so nothing below moves. */
function SlackLine({ schedule, onUseJunoHours }: { readonly schedule: SlackScheduleState | undefined; readonly onUseJunoHours: () => void }) {
  return (
    <div aria-live="polite" {...stylex.props(styles.slackLine)}>
      {schedule?.waitingForHours === true ? (
        <Text variant="meta" tone="muted">
          Slack's schedule changes once you set your notification hours.
        </Text>
      ) : null}
      {schedule?.changedInSlack === true ? (
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

/** Send test notification. When Juno cannot tell whether macOS lets it notify, Open Notification Settings sits beside it. */
function TestRow({ permission, onSendTest, onOpenSettings }: Pick<NotificationsPageProps, 'permission' | 'onSendTest' | 'onOpenSettings'>) {
  return (
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
        <Label title="Test notification" sub="If none appears, Focus or Do Not Disturb may be on." />
      </ListRow>
    </Surface>
  )
}

/** The days on the left, the times on the right. The section's heading names the row. */
function HoursRow({
  which,
  title,
  hours,
  onChange,
  onDayChange,
}: {
  readonly which: HoursKind
  readonly title: string
  readonly hours: Hours
  readonly onChange: NotificationsPageProps['onHoursChange']
  readonly onDayChange: NotificationsPageProps['onDayChange']
}) {
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

function Label({ title, sub }: { readonly title: string; readonly sub: string }) {
  return (
    <span {...stylex.props(styles.label)}>
      <Text variant="ui" weight="medium">
        {title}
      </Text>
      <Text variant="meta" tone="muted">
        {sub}
      </Text>
    </span>
  )
}

function count(n: number) {
  return (
    <Text variant="body" tone="inherit" weight="semibold" numeric as="span">
      {n}
    </Text>
  )
}

/** The label column of a row: 260px (inventory 13). */
const LABEL_WIDTH = 260 // tokens-allow: the row's label column

const styles = stylex.create({
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    width: LABEL_WIDTH,
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
  // Under the hours row, at its start; its height kept when empty.
  slackLine: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing['--space-2'],
    rowGap: spacing['--space-1'],
    // As tall as Use Juno's hours, so the line coming or going moves nothing.
    minHeight: sizes['--control-28'],
    paddingInline: spacing['--space-3-5'],
    paddingBottom: spacing['--space-2'],
  },
  // Scrolled to the top of the page's scroller with the section's own room above it.
  anchor: {
    scrollMarginTop: spacing['--space-6'],
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
