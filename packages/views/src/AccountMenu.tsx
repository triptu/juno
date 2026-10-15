import * as stylex from '@stylexjs/stylex'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { Eye } from '@phosphor-icons/react/dist/icons/Eye'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import { Gear } from '@phosphor-icons/react/dist/icons/Gear'
import { Moon } from '@phosphor-icons/react/dist/icons/Moon'
import { Sun } from '@phosphor-icons/react/dist/icons/Sun'
import { useState, type ReactNode } from 'react'
import { colors, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, OptionHeader, OptionList, OptionRow, OptionSeparator, Text, useOptionListKeys, type HueName, type PhosphorIcon } from '@juno/ui'

export interface AccountMenuSection {
  readonly title: string
  readonly content: ReactNode
}

export type AccountMenuAction = 'presence' | 'privacy' | 'notifications' | 'preferences'

export interface AccountMenuProps {
  readonly name: string
  readonly initials: string
  readonly hue: HueName
  readonly avatarUrl?: string
  /** "acme.slack.com", or the team name. Shown until presence is known. */
  readonly workspace: string
  /** What Slack shows, and the line under the name: "Active", "Away until 9am". */
  readonly presence?: { readonly active: boolean; readonly label: string }
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
 * Show message text (privacy mode), the Notifications and Preferences
 * pages, then the blocks the owner passes.
 */
export function AccountMenu({ name, initials, hue, avatarUrl, workspace, presence, paused, privacy = false, onAction, sections }: AccountMenuProps) {
  const items: ReadonlyArray<Item> =
    onAction === undefined
      ? []
      : [
          presence?.active === false ? { id: 'presence', icon: Sun, label: 'Set yourself active' } : { id: 'presence', icon: Moon, label: 'Set yourself away' },
          privacy ? { id: 'privacy', icon: Eye, label: 'Show message text', hint: '⌃⌘H' } : { id: 'privacy', icon: EyeSlash, label: 'Hide message text', hint: '⌃⌘H' },
          { id: 'notifications', icon: Bell, label: 'Notifications', ...(paused === undefined ? {} : { hint: paused }) },
          { id: 'preferences', icon: Gear, label: 'Preferences', hint: '⌘,' },
        ]
  const [active, setActive] = useState<string | undefined>(undefined)
  const choose = (id: string) => onAction?.(id as AccountMenuAction)
  const onKeyDown = useOptionListKeys({ ids: items.map((item) => `account-${item.id}`), activeId: active, onActiveChange: setActive, onSelect: (id) => choose(id.slice('account-'.length)) })
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
              <span aria-hidden {...stylex.props(styles.dot, presence.active ? styles.dotActive : styles.dotAway)} />
            </span>
          )
        }
        title={name}
        sub={presence?.label ?? workspace}
      />
      {items.length > 0 ? (
        <>
          <OptionSeparator />
          <OptionList role="menu" label="Account" focusable activeId={active === undefined ? undefined : active} onKeyDown={onKeyDown}>
            {items.map((item) => (
              <OptionRow
                key={item.id}
                id={`account-${item.id}`}
                active={active === `account-${item.id}`}
                leading={<Icon icon={item.icon} size={15} />}
                label={item.label}
                {...(item.hint === undefined ? {} : { sub: item.hint })}
                onActivate={() => setActive(`account-${item.id}`)}
                onSelect={() => choose(item.id)}
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

/** The presence dot: 10px with a 2px ring in the menu surface (inventory 2.1). */
const DOT = '10px'

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
  dot: {
    position: 'absolute',
    right: `calc(-1 * ${spacing['--space-0-5']})`,
    bottom: `calc(-1 * ${spacing['--space-0-5']})`,
    width: DOT,
    height: DOT,
    boxSizing: 'border-box',
    borderRadius: radii['--radius-full'],
    borderWidth: sizes['--focus-ring-width'],
    borderStyle: 'solid',
    borderColor: colors['--surface-default'],
  },
  dotActive: {
    backgroundColor: colors['--success'],
  },
  dotAway: {
    backgroundColor: colors['--surface-default'],
    boxShadow: `inset 0 0 0 1px ${colors['--foreground-muted']}`, // tokens-allow: The inset ring is a 1px hairline.
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
