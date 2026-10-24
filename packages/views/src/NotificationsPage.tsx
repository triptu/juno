import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NotificationPermission, PickConversation } from '@juno/contract'
import { Page, PageHeader } from '@juno/ui'
import { AlwaysNotifySection } from './AlwaysNotifySection'
import { HuddleRingSection, type HuddleRingProps } from './HuddleRingSection'
import { InstructionsSection, type InstructionsSectionProps } from './InstructionsSection'
import { NotificationDetails, type ProposedInstruction, type WhyActions } from './NotificationDetails'
import type { AlwaysNotify, AlwaysNotifyKey, Decision, LevelTag } from './notificationRules'
import { NotifyLevelsSection, type LevelPicker, type ListedLevel } from './NotifyLevelsSection'
import { HoursSections, HowAutoDecides, TestSection, TodaySection, type HoursProps } from './NotificationsParts'
import { PermissionLine } from './PermissionLine'
import { SheetLayer } from './SheetLayer'


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
  /** Details lists only the latest of today's decisions. */
  readonly capped?: boolean
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
  /** The add row's direction to start with (fixtures). */
  readonly initialDirection?: InstructionsSectionProps['initialDirection']
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
  const { aiAssist, alwaysNotify, onAlwaysNotifyChange, always, never, onRemoveLevel, picker, onPickLevel, onOpenIgnored, notifiedToday, stayedToday, onDetailsOpenChange, permission, onSendTest, onOpenSettings, onAllow, huddleRing, onHuddleRingChange, anchor, anchorKey, initialDirection } = props
  const headings = useRef<Partial<Record<NotificationsAnchor, HTMLElement | null>>>({})
  const [detailsOpen, setDetailsShown] = useState(false)
  const setDetailsOpen = (open: boolean) => {
    setDetailsShown(open)
    onDetailsOpenChange?.(open)
  }
  // Before paint, so the page opens already at the part asked for; again for each new ask.
  useLayoutEffect(() => {
    if (anchor === undefined || anchorKey === undefined) return
    const heading = headings.current[anchor]
    if (heading === null || heading === undefined) return
    heading.scrollIntoView({ block: 'start', behavior: 'instant' })
    heading.tabIndex = -1
    // Focus for screen readers and the next Tab, with no ring: the owner did not press a key here.
    heading.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
  }, [anchor, anchorKey])
  const heading = (name: NotificationsAnchor) => (element: HTMLElement | null) => void (headings.current[name] = element)
  return (
    <Page width="settings">
      <PageHeader title="Notifications" subtitle="Inside your notification hours, Juno notifies you about what needs you. Everything is in Juno whenever you open it." />
      <PermissionLine permission={permission} onOpenSettings={onOpenSettings} onAllow={onAllow} />
      <HoursSections {...props} hoursRef={heading('hours')} />
      <AlwaysNotifySection alwaysNotify={alwaysNotify} onAlwaysNotifyChange={onAlwaysNotifyChange} headingRef={heading('always-notify')} />
      <InstructionsSection {...props} aiAssist={aiAssist} headingRef={heading('instructions')} {...(initialDirection === undefined ? {} : { initialDirection })} />
      <NotifyLevelsSection always={always} never={never} onRemove={onRemoveLevel} picker={picker} onPick={onPickLevel} onOpenIgnored={onOpenIgnored} headingRef={heading('levels')} />
      <HowAutoDecides headingRef={heading('how-auto')} />
      <TodaySection notifiedToday={notifiedToday} stayedToday={stayedToday} detailsOpen={detailsOpen} onDetails={() => setDetailsOpen(true)} />
      <HuddleRingSection huddleRing={huddleRing} onHuddleRingChange={onHuddleRingChange} />
      <TestSection permission={permission} onSendTest={onSendTest} onOpenSettings={onOpenSettings} />
      {detailsOpen ? <DetailsSheet {...props} onClose={() => setDetailsOpen(false)} /> : null}
    </Page>
  )
}

/** Today's Details over the window, outside the page's scroller. An action that opens a part of the page closes the sheet first. */
function DetailsSheet(props: NotificationsPageProps & { readonly onClose: () => void }) {
  const { onClose } = props
  const closing = <A extends ReadonlyArray<unknown>>(action: (...args: A) => void) => (...args: A) => {
    onClose()
    action(...args)
  }
  return createPortal(
    <SheetLayer onClose={onClose}>
      <NotificationDetails
        {...props}
        onSettings={closing(props.onSettings)}
        onEditInstructions={closing(props.onEditInstructions)}
        onChange={closing(props.onChange)}
      />
    </SheetLayer>,
    document.body,
  )
}

