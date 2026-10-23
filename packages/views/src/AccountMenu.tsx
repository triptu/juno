import * as stylex from '@stylexjs/stylex'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { Eye } from '@phosphor-icons/react/dist/icons/Eye'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import { Gear } from '@phosphor-icons/react/dist/icons/Gear'
import { Moon } from '@phosphor-icons/react/dist/icons/Moon'
import { Sun } from '@phosphor-icons/react/dist/icons/Sun'
import type { ReactNode } from 'react'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, OptionHeader, OptionList, OptionRow, OptionSeparator, PresenceDot, Text, useMenuActive, type HueName, type PhosphorIcon } from '@juno/ui'

export interface AccountMenuSection {
  readonly title: string
  readonly content: ReactNode
}

export type AccountMenuAction = 'presence' | 'privacy' | 'notifications' | 'settings'

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
  /** Privacy mode is on: the item offers Show message text instead of Hide (SPEC section 5). */
  readonly privacy?: boolean
  readonly onAction?: (action: AccountMenuAction) => void
  /** Titled blocks under the items, separated by hairlines. */
  readonly sections: ReadonlyArray<AccountMenuSection>
}

interface Item {
  readonly id: AccountMenuAction
  readonly icon: PhosphorIcon
  readonly label: string
  readonly hint?: string
}

/**
 * What the avatar button opens (inventory 2.1): who is signed in and
 * whether Slack shows them active, Set yourself away or active, Hide or
 * Show message text (privacy mode), Notifications and Settings (both
 * open Settings, at Notifications and at General), then the blocks the
 * owner passes.
 */
export function AccountMenu({ name, initials, hue, avatarUrl, workspace, presence, paused, privacy = false, onAction, sections }: AccountMenuProps) {
  const items: ReadonlyArray<Item> =
    onAction === undefined
      ? []
      : [
          presence?.active === false ? { id: 'presence', icon: Sun, label: 'Set yourself active' } : { id: 'presence', icon: Moon, label: 'Set yourself away' },
          privacy ? { id: 'privacy', icon: Eye, label: 'Show message text', hint: '⌃⌘H' } : { id: 'privacy', icon: EyeSlash, label: 'Hide message text', hint: '⌃⌘H' },
          { id: 'notifications', icon: Bell, label: 'Notifications', ...(paused === undefined ? {} : { hint: paused }) },
          { id: 'settings', icon: Gear, label: 'Settings', hint: '⌘,' },
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
        title={name}
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
                leading={<Icon icon={item.icon} size={15} />}
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
