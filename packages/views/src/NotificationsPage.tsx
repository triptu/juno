import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, useState } from 'react'
import type { NotificationPermission, PickConversation } from '@juno/contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Page, PageHeader } from '@juno/ui'
import { AlwaysNotifySection } from './AlwaysNotifySection'
import { HuddleRingSection, type HuddleRingProps } from './HuddleRingSection'
import { InstructionsSection, type InstructionsSectionProps } from './InstructionsSection'
import { NotificationDetails, type DetailsFilter, type ProposedInstruction, type WhyActions } from './NotificationDetails'
import type { AlwaysNotify, AlwaysNotifyKey, Decision, LevelTag } from './notificationRules'
import { NotifyLevelsSection, type LevelPicker, type ListedLevel } from './NotifyLevelsSection'
import { HoursSections, HowAutoDecides, TestSection, TodaySection, type HoursProps } from './NotificationsParts'
import { PermissionLine } from './PermissionLine'
import { SheetLayer } from './SheetLayer'

export type { HoursKind } from './NotificationsParts'

/** A part of the page another place opens it at. */
export type NotificationsAnchor = 'hours' | 'always-notify' | 'instructions' | 'levels' | 'how-auto'

export interface NotificationsPageProps extends HoursProps, HuddleRingProps, Omit<InstructionsSectionProps, 'aiAssist' | 'initialDirection'>, WhyActions {
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
  readonly details?: { readonly filter?: DetailsFilter; readonly open?: string }
  /** The add row's direction to start with (fixtures). */
  readonly initialDirection?: InstructionsSectionProps['initialDirection']
  /** Which Add… starts open (fixtures). */
  readonly initialPicker?: ListedLevel
}

/**
 * Settings › Notifications (SPEC 14, inventory 13): the two sets of hours
 * with Slack's schedule line, the Always notify switches, the owner's
 * instructions, what is set to Always and Never, how Auto decides, today's
 * line with Details, Ring for huddles and a test notification. While macOS
 * does not let Juno notify, a line at the top says so, with the way to
 * turn it on.
 */
export function NotificationsPage(props: NotificationsPageProps) {
  const { aiAssist, alwaysNotify, onAlwaysNotifyChange, always, never, onRemoveLevel, picker, onPickLevel, onOpenIgnored, notifiedToday, stayedToday, onDetailsOpenChange, permission, onSendTest, onOpenSettings, onAllow, huddleRing, onHuddleRingChange, anchor, anchorKey, details, initialDirection, initialPicker } = props
  const anchors = useRef<Partial<Record<NotificationsAnchor, HTMLDivElement | null>>>({})
  const [detailsOpen, setDetailsShown] = useState(details !== undefined)
  const setDetailsOpen = (open: boolean) => {
    setDetailsShown(open)
    onDetailsOpenChange?.(open)
  }
  // Before paint, so the page opens already at the part asked for; again for each new ask.
  useLayoutEffect(() => {
    if (anchor === undefined || anchorKey === undefined) return
    const part = anchors.current[anchor]
    // The section's heading: the first line of its head.
    const heading = part?.querySelector<HTMLElement>('section > div > :first-child') ?? part
    if (heading === null || heading === undefined) return
    heading.scrollIntoView({ block: 'start', behavior: 'instant' })
    heading.tabIndex = -1
    // Focus for screen readers and the next Tab, with no ring: the owner did not press a key here.
    heading.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
  }, [anchor, anchorKey])
  const part = (name: NotificationsAnchor) => (element: HTMLDivElement | null) => void (anchors.current[name] = element)
  return (
    <Page width="settings">
      <PageHeader title="Notifications" subtitle="Inside your notification hours, Juno notifies you about what needs you. Everything is in Juno whenever you open it." />
      <PermissionLine permission={permission} onOpenSettings={onOpenSettings} onAllow={onAllow} />
      <HoursSections {...props} hoursRef={part('hours')} />
      <div ref={part('always-notify')} {...stylex.props(styles.anchor)}>
        <AlwaysNotifySection alwaysNotify={alwaysNotify} onAlwaysNotifyChange={onAlwaysNotifyChange} />
      </div>
      <div ref={part('instructions')} {...stylex.props(styles.anchor)}>
        <InstructionsSection {...props} aiAssist={aiAssist} {...(initialDirection === undefined ? {} : { initialDirection })} />
      </div>
      <div ref={part('levels')} {...stylex.props(styles.anchor)}>
        <NotifyLevelsSection always={always} never={never} onRemove={onRemoveLevel} picker={picker} onPick={onPickLevel} onOpenIgnored={onOpenIgnored} {...(initialPicker === undefined ? {} : { initialPicker })} />
      </div>
      <div ref={part('how-auto')} {...stylex.props(styles.anchor)}>
        <HowAutoDecides />
      </div>
      <TodaySection notifiedToday={notifiedToday} stayedToday={stayedToday} detailsOpen={detailsOpen} onDetails={() => setDetailsOpen(true)} />
      <HuddleRingSection huddleRing={huddleRing} onHuddleRingChange={onHuddleRingChange} />
      <TestSection permission={permission} onSendTest={onSendTest} onOpenSettings={onOpenSettings} />
      {detailsOpen ? <DetailsSheet {...props} onClose={() => setDetailsOpen(false)} /> : null}
    </Page>
  )
}

/** Today's Details over the page. An action that opens a part of the page closes the sheet first. */
function DetailsSheet(props: NotificationsPageProps & { readonly onClose: () => void }) {
  const { onClose, details } = props
  const closing = <A extends ReadonlyArray<unknown>>(action: (...args: A) => void) => (...args: A) => {
    onClose()
    action(...args)
  }
  return (
    <SheetLayer onClose={onClose}>
      <NotificationDetails
        {...props}
        onSettings={closing(props.onSettings)}
        onEditInstructions={closing(props.onEditInstructions)}
        onChange={closing(props.onChange)}
        {...(details?.filter === undefined ? {} : { initialFilter: details.filter })}
        {...(details?.open === undefined ? {} : { initialOpen: details.open })}
      />
    </SheetLayer>
  )
}

const styles = stylex.create({
  // Scrolled to the top of the page's scroller with the section's own room above it.
  anchor: {
    scrollMarginTop: spacing['--space-6'],
  },
})
