import * as stylex from '@stylexjs/stylex'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { BellRinging } from '@phosphor-icons/react/dist/icons/BellRinging'
import { BellSlash } from '@phosphor-icons/react/dist/icons/BellSlash'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Eye } from '@phosphor-icons/react/dist/icons/Eye'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import { Gear } from '@phosphor-icons/react/dist/icons/Gear'
import { Moon } from '@phosphor-icons/react/dist/icons/Moon'
import { Sun } from '@phosphor-icons/react/dist/icons/Sun'
import { useEffect, type KeyboardEvent, type ReactNode } from 'react'
import type { PauseChoice } from '@juno/contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, OptionHeader, OptionList, OptionRow, OptionSeparator, PresenceDot, Submenu, Text, lastInputWasKeyboard, useMenuActive, useSubmenu, type HueName, type PhosphorIcon } from '@juno/ui'

export interface AccountMenuSection {
  readonly title: string
  readonly content: ReactNode
}

export type AccountMenuAction = 'presence' | 'privacy' | 'notifications' | 'resume' | 'settings'

export interface AccountMenuProps {
  readonly name: string
  readonly initials: string
  readonly hue: HueName
  readonly avatarUrl?: string
  /** "acme.slack.com", or the team name. Shown until presence is known. */
  readonly workspace: string
  /**
   * The presence setting (`active`, which the toggle reads), whether Slack shows colleagues you as
   * active (`seen`, the dot), and the line under the name: "Active", "Away until 9am", "Active.
   * Slack shows you away".
   */
  readonly presence?: { readonly active: boolean; readonly seen: boolean; readonly label: string }
  /**
   * "Paused until 9am" while notifications are paused (outside notification hours or snoozed): the avatar's paused
   * badge, and beside Notification settings when the hours, not a snooze, pause them.
   */
  readonly paused?: string
  /** Slack's snooze runs: the menu offers Resume notifications in place of Pause notifications. */
  readonly snoozed?: boolean
  /** While snoozed, "Paused until 11:11pm" beside Resume notifications: the snooze's own end. */
  readonly snoozeLabel?: string
  /** When each Pause notifications choice would end if picked now, beside it: "3:47pm", "9am", "Mon 9am". */
  readonly pauseEnds?: Readonly<Record<PauseChoice, string>>
  /** One of Pause notifications' choices: Slack's snooze for that long. */
  readonly onPause?: (choice: PauseChoice) => void
  /** Privacy mode is on: the item offers Show message text instead of Hide (SPEC section 5). */
  readonly privacy?: boolean
  readonly onAction?: (action: AccountMenuAction) => void
  /** Titled blocks under the items, separated by hairlines. */
  readonly sections: ReadonlyArray<AccountMenuSection>
}

interface Item {
  readonly id: AccountMenuAction | 'pause'
  readonly icon: PhosphorIcon
  readonly label: string
  readonly hint?: string
  /** The hint is a sentence ("Paused until tomorrow 9am"): on a second line, so the label is not cut. */
  readonly hintBelow?: boolean
}

/** Slack's Pause notifications choices, in its order and words. */
const pauseItems: ReadonlyArray<{ readonly id: PauseChoice; readonly label: string }> = [
  { id: '30m', label: '30 minutes' },
  { id: '1h', label: '1 hour' },
  { id: '2h', label: '2 hours' },
  { id: 'tomorrow', label: 'Until tomorrow' },
  { id: 'nextWeek', label: 'Until next week' },
]

const PAUSE_ROW = 'account-pause'
const pauseIds = pauseItems.map((item) => `account-pause-${item.id}`)

/**
 * What the avatar button opens (inventory 2.1): who is signed in and
 * whether Slack shows them active, Set yourself away or active, Hide or
 * Show message text (privacy mode), Notification settings and Settings
 * (both open Settings, at Notifications and at General), Pause
 * notifications (Slack's snooze, its choices in a submenu beside the menu)
 * or Resume notifications while snoozed, then the blocks the owner passes.
 */
export function AccountMenu({ name, initials, hue, avatarUrl, workspace, presence, paused, snoozed = false, snoozeLabel, pauseEnds, onPause, privacy = false, onAction, sections }: AccountMenuProps) {
  const avatar = <Avatar label={initials} name={name} hue={hue} size={32} {...(avatarUrl === undefined ? {} : { src: avatarUrl })} />
  return (
    <div {...stylex.props(styles.root)}>
      <OptionHeader
        leading={
          presence === undefined ? (
            avatar
          ) : (
            <span {...stylex.props(styles.avatar)}>
              {avatar}
              <PresenceDot active={presence.seen} surface="raised" paused={paused !== undefined} />
            </span>
          )
        }
        title={name}
        sub={presence?.label ?? workspace}
      />
      {onAction === undefined ? null : (
        <AccountItems
          items={accountItems({ presence, paused, snoozed, snoozeLabel, privacy, canPause: onPause !== undefined })}
          onAction={onAction}
          {...(pauseEnds === undefined ? {} : { pauseEnds })}
          {...(snoozed || onPause === undefined ? {} : { onPause })}
        />
      )}
      {sections.map((section) => (
        <div key={section.title} {...stylex.props(styles.section)}>
          <OptionSeparator />
          <section aria-label={section.title} {...stylex.props(styles.block)}>
            <Text variant="sectionLabel" tone="muted" as="h3">
              {section.title}
            </Text>
            {section.content}
          </section>
        </div>
      ))}
    </div>
  )
}

function accountItems({ presence, paused, snoozed, snoozeLabel, privacy, canPause }: Pick<AccountMenuProps, 'presence' | 'paused' | 'snoozeLabel'> & { readonly snoozed: boolean; readonly privacy: boolean; readonly canPause: boolean }): ReadonlyArray<Item> {
  // While snoozed, Resume says until when; the settings row says it only when the notification hours pause notifications.
  const settingsHint = snoozed || paused === undefined ? {} : { hint: paused, hintBelow: true }
  return [
    presence?.active === false ? { id: 'presence', icon: Sun, label: 'Set yourself active' } : { id: 'presence', icon: Moon, label: 'Set yourself away' },
    privacy ? { id: 'privacy', icon: Eye, label: 'Show message text', hint: '⌃⌘H' } : { id: 'privacy', icon: EyeSlash, label: 'Hide message text', hint: '⌃⌘H' },
    { id: 'notifications', icon: Bell, label: 'Notification settings', ...settingsHint },
    ...(snoozed
      ? [{ id: 'resume', icon: BellRinging, label: 'Resume notifications', ...(snoozeLabel === undefined ? {} : { hint: snoozeLabel, hintBelow: true }) } as const]
      : canPause
        ? [{ id: 'pause', icon: BellSlash, label: 'Pause notifications' } as const]
        : []),
    { id: 'settings', icon: Gear, label: 'Settings', hint: '⌘,' },
  ]
}

/**
 * The menu's items. Pause notifications (with `onPause`) opens Slack's choices in a submenu beside the menu
 * (`useSubmenu`): on a rest of the pointer, a click, → or Enter. The list takes focus when the menu opens from the
 * keyboard, so ↓ works at once.
 */
function AccountItems({ items, onAction, onPause, pauseEnds }: { readonly items: ReadonlyArray<Item>; readonly onAction: (action: AccountMenuAction) => void; readonly onPause?: (choice: PauseChoice) => void; readonly pauseEnds?: Readonly<Record<PauseChoice, string>> }) {
  const ids = items.map((item) => `account-${item.id}`)
  const select = (id: string) => {
    if (id === PAUSE_ROW) return
    onAction(id.slice('account-'.length) as AccountMenuAction)
  }
  const menu = useMenuActive(ids, select)
  const choose = (id: string) => onPause?.(id.slice('account-pause-'.length) as PauseChoice)
  const sub = useSubmenu({ triggerId: PAUSE_ROW, ids: pauseIds, onSelect: choose })
  useEffect(() => {
    // Opened from the keyboard, the list takes focus, so ↓ works at once. Opened with the pointer it does not, so no
    // focus ring appears.
    if (!lastInputWasKeyboard()) return
    document.getElementById(ids[0] ?? '')?.closest<HTMLElement>('[role="menu"]')?.focus({ preventScroll: true })
    // Once, when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (sub.keyDown(event, menu.list.activeId)) return
    menu.list.onKeyDown(event)
  }
  const rowOf = (item: Item) => {
    const id = `account-${item.id}`
    const row = menu.row(id)
    const below = item.hintBelow === true && item.hint !== undefined
    const props = {
      ...row,
      leading: <Icon icon={item.icon} size={15} />,
      label: below ? (
        <span {...stylex.props(styles.stack)}>
          {item.label}
          <Text variant="meta" tone="muted" truncate>
            {item.hint}
          </Text>
        </span>
      ) : (
        item.label
      ),
      ...(below || item.hint === undefined ? {} : { sub: item.hint }),
    }
    if (item.id !== 'pause' || onPause === undefined) {
      return <OptionRow key={item.id} {...props} onActivate={() => sub.hoverOther(row.onActivate)} onSelect={() => select(id)} />
    }
    return (
      <Submenu
        key={item.id}
        open={sub.open}
        onClose={sub.hide}
        label="Pause notifications"
        list={sub.list}
        trigger={
          <OptionRow
            {...props}
            active={row.active || sub.open}
            trailing={<Icon icon={CaretRight} size={13} />}
            onActivate={() => {
              row.onActivate()
              sub.hoverTrigger()
            }}
            onSelect={sub.clickTrigger}
          />
        }
      >
        {pauseItems.map((choice) => {
          const end = pauseEnds?.[choice.id]
          return <OptionRow key={choice.id} {...sub.row(`account-pause-${choice.id}`)} label={choice.label} {...(end === undefined ? {} : { sub: end })} onSelect={() => choose(`account-pause-${choice.id}`)} />
        })}
      </Submenu>
    )
  }
  return (
    <>
      <OptionSeparator />
      <OptionList role="menu" label="Account" {...menu.list} onKeyDown={keys} onPointerMove={sub.trackPointer}>
        {items.map(rowOf)}
      </OptionList>
    </>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  avatar: {
    position: 'relative',
    display: 'inline-flex',
  },
  // A row's label with its hint under it, in the menu's own type, so the row keeps its inset.
  stack: {
    display: 'flex',
    flexDirection: 'column',
    paddingBlock: spacing['--space-1'],
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
  },
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2-5'],
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2'],
  },
})
