import * as stylex from '@stylexjs/stylex'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { Eye } from '@phosphor-icons/react/dist/icons/Eye'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import { Gear } from '@phosphor-icons/react/dist/icons/Gear'
import { Moon } from '@phosphor-icons/react/dist/icons/Moon'
import { Sun } from '@phosphor-icons/react/dist/icons/Sun'
import type { ReactNode } from 'react'
import type { StatusEmoji } from '@juno/contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, OptionHeader, OptionList, OptionRow, OptionSeparator, PresenceDot, SmileyPlus, Text, useMenuActive, type HueName, type PhosphorIcon } from '@juno/ui'
import { EmojiFace } from './StatusSheet'

export interface AccountMenuSection {
  readonly title: string
  readonly content: ReactNode
}

export type AccountMenuAction = 'status' | 'presence' | 'privacy' | 'notifications' | 'settings'

/** Your status as the menu shows it: the emoji and text, and "until 5pm" when it clears. */
export interface AccountStatus {
  readonly emoji?: StatusEmoji | undefined
  readonly text: string
  readonly until?: string | undefined
}

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
  /** "Paused until 9am" outside notification hours, beside Notifications. */
  readonly paused?: string
  /** Your status; none offers Set a status. */
  readonly status?: AccountStatus | undefined
  /** Privacy mode is on: the item offers Show message text instead of Hide (SPEC section 5). */
  readonly privacy?: boolean
  readonly onAction?: (action: AccountMenuAction) => void
  /** Titled blocks under the items, separated by hairlines. */
  readonly sections: ReadonlyArray<AccountMenuSection>
}

interface Item {
  readonly id: AccountMenuAction
  readonly leading: ReactNode
  readonly label: string
  readonly hint?: string
}

const icon = (glyph: PhosphorIcon) => <Icon icon={glyph} size={15} />

/**
 * What the avatar button opens (inventory 2.1): who is signed in, with
 * their status's emoji, and whether Slack shows them active; your status,
 * or Set a status, which opens the status sheet; Set yourself away or active, Hide or
 * Show message text (privacy mode), Notifications and Settings (both
 * open Settings, at Notifications and at General), then the blocks the
 * owner passes.
 */
export function AccountMenu({ name, initials, hue, avatarUrl, workspace, presence, paused, status, privacy = false, onAction, sections }: AccountMenuProps) {
  const items: ReadonlyArray<Item> =
    onAction === undefined
      ? []
      : [
          status === undefined
            ? { id: 'status', leading: icon(SmileyPlus), label: 'Set a status' }
            : { id: 'status', leading: status.emoji === undefined ? icon(SmileyPlus) : <EmojiFace emoji={status.emoji} size={16} />, label: status.text === '' ? 'Edit your status' : status.text, ...(status.until === undefined ? {} : { hint: status.until }) },
          presence?.active === false ? { id: 'presence', leading: icon(Sun), label: 'Set yourself active' } : { id: 'presence', leading: icon(Moon), label: 'Set yourself away' },
          privacy ? { id: 'privacy', leading: icon(Eye), label: 'Show message text', hint: '⌃⌘H' } : { id: 'privacy', leading: icon(EyeSlash), label: 'Hide message text', hint: '⌃⌘H' },
          { id: 'notifications', leading: icon(Bell), label: 'Notifications', ...(paused === undefined ? {} : { hint: paused }) },
          { id: 'settings', leading: icon(Gear), label: 'Settings', hint: '⌘,' },
        ]
  const menu = useMenuActive(
    items.map((item) => `account-${item.id}`),
    (id) => onAction?.(id.slice('account-'.length) as AccountMenuAction),
  )
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
        title={
          status?.emoji === undefined ? (
            name
          ) : (
            <span {...stylex.props(styles.title)}>
              {name}
              <span data-account-status-emoji="" {...stylex.props(styles.titleEmoji)}>
                <EmojiFace emoji={status.emoji} size={14} />
              </span>
            </span>
          )
        }
        sub={presence?.label ?? workspace}
      />
      {items.length > 0 ? (
        <>
          <OptionSeparator />
          <OptionList role="menu" label="Account" {...menu.list}>
            {items.map((item) => (
              <OptionRow
                key={item.id}
                {...menu.row(`account-${item.id}`)}
                leading={item.leading}
                label={item.label}
                {...(item.hint === undefined ? {} : { sub: item.hint })}
                onSelect={() => onAction?.(item.id)}
              />
            ))}
          </OptionList>
        </>
      ) : null}
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

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  title: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    maxWidth: '100%',
  },
  titleEmoji: {
    display: 'inline-flex',
    flexShrink: 0,
  },
  avatar: {
    position: 'relative',
    display: 'inline-flex',
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
