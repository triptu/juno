import * as stylex from '@stylexjs/stylex'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { BellSlash } from '@phosphor-icons/react/dist/icons/BellSlash'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Eye } from '@phosphor-icons/react/dist/icons/Eye'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import { Gear } from '@phosphor-icons/react/dist/icons/Gear'
import { Moon } from '@phosphor-icons/react/dist/icons/Moon'
import { Sun } from '@phosphor-icons/react/dist/icons/Sun'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import type { PauseChoice } from '@juno/contract'
import { sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, OptionHeader, OptionList, OptionRow, OptionSeparator, PresenceDot, Text, useMenuActive, type HueName, type PhosphorIcon } from '@juno/ui'

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
  /** "Paused until 9am" while notifications are paused (outside notification hours or snoozed), beside Notifications. */
  readonly paused?: string
  /** Slack's snooze runs: the menu offers Resume notifications in place of Pause notifications. */
  readonly snoozed?: boolean
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
}

/** Slack's Pause notifications choices, in its order and words. */
const pauseItems: ReadonlyArray<{ readonly id: PauseChoice; readonly label: string }> = [
  { id: '30m', label: '30 minutes' },
  { id: '1h', label: '1 hour' },
  { id: '2h', label: '2 hours' },
  { id: 'tomorrow', label: 'Until tomorrow' },
  { id: 'nextWeek', label: 'Until next week' },
]

/**
 * What the avatar button opens (inventory 2.1): who is signed in and
 * whether Slack shows them active, Set yourself away or active, Hide or
 * Show message text (privacy mode), Notifications and Settings (both
 * open Settings, at Notifications and at General), Pause or Resume
 * notifications (Slack's snooze), then the blocks the owner passes.
 */
export function AccountMenu({ name, initials, hue, avatarUrl, workspace, presence, paused, snoozed = false, onPause, privacy = false, onAction, sections }: AccountMenuProps) {
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
          items={accountItems({ presence, paused, snoozed, privacy, canPause: onPause !== undefined })}
          onAction={onAction}
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

function accountItems({ presence, paused, snoozed, privacy, canPause }: Pick<AccountMenuProps, 'presence' | 'paused'> & { readonly snoozed: boolean; readonly privacy: boolean; readonly canPause: boolean }): ReadonlyArray<Item> {
  return [
    presence?.active === false ? { id: 'presence', icon: Sun, label: 'Set yourself active' } : { id: 'presence', icon: Moon, label: 'Set yourself away' },
    privacy ? { id: 'privacy', icon: Eye, label: 'Show message text', hint: '⌃⌘H' } : { id: 'privacy', icon: EyeSlash, label: 'Hide message text', hint: '⌃⌘H' },
    { id: 'notifications', icon: Bell, label: 'Notifications', ...(paused === undefined ? {} : { hint: paused }) },
    ...(snoozed ? [{ id: 'resume', icon: Bell, label: 'Resume notifications' } as const] : canPause ? [{ id: 'pause', icon: BellSlash, label: 'Pause notifications' } as const] : []),
    { id: 'settings', icon: Gear, label: 'Settings', hint: '⌘,' },
  ]
}

/**
 * The menu's items. Pause notifications (with `onPause`) shows Slack's choices in their place; → on it opens
 * them, and the first row or ← goes back.
 */
function AccountItems({ items, onAction, onPause }: { readonly items: ReadonlyArray<Item>; readonly onAction: (action: AccountMenuAction) => void; readonly onPause?: (choice: PauseChoice) => void }) {
  const [page, setPage] = useState<'items' | 'pause'>('items')
  const pausing = page === 'pause' && onPause !== undefined
  const ids = pausing ? ['account-back', ...pauseItems.map((item) => `account-pause-${item.id}`)] : items.map((item) => `account-${item.id}`)
  const select = (id: string) => {
    if (id === 'account-back') return setPage('items')
    if (id === 'account-pause') return setPage('pause')
    if (id.startsWith('account-pause-')) return onPause?.(id.slice('account-pause-'.length) as PauseChoice)
    onAction(id.slice('account-'.length) as AccountMenuAction)
  }
  const menu = useMenuActive(ids, select)
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    const toPage = pausing ? (event.key === 'ArrowLeft' ? 'items' : undefined) : event.key === 'ArrowRight' && menu.list.activeId === 'account-pause' ? 'pause' : undefined
    if (toPage === undefined) return menu.list.onKeyDown(event)
    event.preventDefault()
    setPage(toPage)
  }
  return (
    <>
      <OptionSeparator />
      {pausing ? (
        <OptionList role="menu" label="Pause notifications" {...menu.list} onKeyDown={keys}>
          <OptionRow {...menu.row('account-back')} leading={<Icon icon={CaretLeft} size={15} />} label="Pause notifications" onSelect={() => select('account-back')} />
          {pauseItems.map((item) => (
            <OptionRow key={item.id} {...menu.row(`account-pause-${item.id}`)} leading={<span {...stylex.props(styles.inset)} />} label={item.label} onSelect={() => select(`account-pause-${item.id}`)} />
          ))}
        </OptionList>
      ) : (
        <OptionList role="menu" label="Account" {...menu.list} onKeyDown={keys}>
          {items.map((item) => (
            <OptionRow
              key={item.id}
              {...menu.row(`account-${item.id}`)}
              leading={<Icon icon={item.icon} size={15} />}
              label={item.label}
              {...(item.hint === undefined ? {} : { sub: item.hint })}
              {...(item.id === 'pause' ? { trailing: <Icon icon={CaretRight} size={13} /> } : {})}
              onSelect={() => select(`account-${item.id}`)}
            />
          ))}
        </OptionList>
      )}
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
  // The choices' text lines up with the items' labels, past the 15px icon slot.
  inset: {
    display: 'inline-block',
    width: sizes['--icon-15'],
    flexShrink: 0,
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
