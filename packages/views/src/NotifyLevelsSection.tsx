import * as stylex from '@stylexjs/stylex'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { useState, type ReactNode, type Ref } from 'react'
import type { PickConversation, PickConversations } from '@juno/contract'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Button, Chip, Popover, Section, Surface, Text, type PhosphorIcon } from '@juno/ui'
import { ConversationList } from './DestinationLists'
import { hueFor, initials } from './look'
import type { LevelTag } from './notificationRules'
import { SettingsLink } from './SettingsLink'

export type ListedLevel = 'always' | 'never'

/** Add…'s searchable list of people and channels. The owner holds the query and the rows. */
export interface LevelPicker {
  readonly query: string
  readonly onQuery: (query: string) => void
  /** Undefined while they load. */
  readonly conversations: PickConversations | undefined
  readonly loading?: boolean
  /** The list opened or closed: the owner asks for rows only while one is open. */
  readonly onOpenChange?: (open: boolean) => void
}

export interface NotifyLevelsSectionProps {
  readonly always: ReadonlyArray<LevelTag>
  readonly never: ReadonlyArray<LevelTag>
  /** Back to Auto. */
  readonly onRemove: (tag: LevelTag) => void
  readonly picker: LevelPicker
  readonly onPick: (level: ListedLevel, conversation: PickConversation) => void
  /** Settings › Ignored. */
  readonly onOpenIgnored: () => void
  /** The heading, for the page to scroll to. */
  readonly headingRef?: Ref<HTMLElement>
}

const channelIcons: Record<Extract<LevelTag, { kind: 'channel' }>['channelKind'], PhosphorIcon> = { public: Hash, private: Lock, im: User, mpim: Users }

/**
 * Settings › Notifications › People, channels and threads (SPEC 14,
 * inventory 13): what is set to Always and to Never, as tags with Remove,
 * and Add… on each row, which searches people and channels. Everything
 * else is on Auto.
 */
export function NotifyLevelsSection({ always, never, onRemove, picker, onPick, onOpenIgnored, headingRef }: NotifyLevelsSectionProps) {
  const [open, setOpen] = useState<ListedLevel | undefined>(undefined)
  const show = (level: ListedLevel | undefined) => {
    setOpen(level)
    picker.onOpenChange?.(level !== undefined)
    if (level === undefined) picker.onQuery('')
  }
  const row = (level: ListedLevel, title: string, sub: ReactNode, tags: ReadonlyArray<LevelTag>, divider: boolean) => (
    // Not a ListRow: its paint containment would clip Add…'s list.
    <div role="group" aria-label={title} {...stylex.props(styles.row, divider && styles.divider)}>
      <span {...stylex.props(styles.body)}>
        <span {...stylex.props(styles.label)}>
          <Text variant="ui" weight="medium">
            {title}
          </Text>
          <Text variant="meta" tone="muted">
            {sub}
          </Text>
        </span>
        <span {...stylex.props(styles.tags)}>
          {tags.map((tag) => (
            <Tag key={`${tag.kind}:${tag.id}`} tag={tag} onRemove={() => onRemove(tag)} />
          ))}
          <Popover
            open={open === level}
            onClose={() => show(undefined)}
            placement="bottom-end"
            width="picker"
            maxHeight="none"
            layer="picker"
            padding="none"
            label={`Add to ${title}`}
            anchor={
              <Button variant="ghost" size="sm" tone="subtle" expanded={open === level} aria-haspopup="dialog" onClick={() => show(open === level ? undefined : level)}>
                Add…
              </Button>
            }
          >
            {open === level ? (
              <ConversationList
                query={picker.query}
                onQuery={picker.onQuery}
                conversations={picker.conversations}
                loading={picker.loading}
                onPickConversation={(conversation) => {
                  onPick(level, conversation)
                  show(undefined)
                }}
                onClose={() => show(undefined)}
              />
            ) : null}
          </Popover>
        </span>
      </span>
    </div>
  )
  return (
    <Section headingRef={headingRef} heading="People, channels and threads" sub="Set from any conversation's menu: Notify me › Always, Auto or Never. Everything else is on Auto.">
      {/* Add…'s list hangs below the card, so the card does not clip. */}
      <Surface kind="group" sx={styles.card}>
        {row('always', 'Always', 'Notifies for every message, inside your hours.', always, true)}
        {row(
          'never',
          'Never',
          <>
            No notifications. A direct mention of you or a group you're in still notifies. <SettingsLink onClick={onOpenIgnored}>Ignored channels</SettingsLink> work the same way.
          </>,
          never,
          false,
        )}
      </Surface>
    </Section>
  )
}

function Tag({ tag, onRemove }: { readonly tag: LevelTag; readonly onRemove: () => void }) {
  const removeLabel = `Remove ${tag.name}`
  if (tag.kind === 'channel') {
    return (
      <Chip variant="filled" size={28} icon={channelIcons[tag.channelKind]} onRemove={onRemove} removeLabel={removeLabel}>
        {tag.name}
      </Chip>
    )
  }
  if (tag.kind === 'thread') {
    return (
      <Chip variant="filled" size={28} icon={ChatCircle} onRemove={onRemove} removeLabel={removeLabel}>
        {tag.name}
      </Chip>
    )
  }
  return (
    <Chip variant="filled" size={28} onRemove={onRemove} removeLabel={removeLabel}>
      <span {...stylex.props(styles.person)}>
        <Avatar size={18} label={initials(tag.name)} name={tag.name} hue={hueFor('', tag.id)} {...(tag.avatarUrl === undefined ? {} : { src: tag.avatarUrl })} />
        {tag.name}
      </span>
    </Chip>
  )
}


const styles = stylex.create({
  card: {
    overflow: 'visible',
  },
  // Inventory 13: padding 10 10 10 14.
  row: {
    paddingBlock: spacing['--space-2-5'],
    paddingInlineStart: spacing['--space-3-5'],
    paddingInlineEnd: spacing['--space-2-5'],
  },
  divider: {
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
  },
  // The label stays at the top while many tags wrap beside it.
  body: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    columnGap: spacing['--space-3'],
    rowGap: spacing['--space-2'],
    width: '100%',
    minWidth: 0,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    width: layout['--settings-label-width'],
    maxWidth: '100%',
    minWidth: 0,
  },
  // Left-aligned after the label, Add… last in the flow, so Always and Never line up and Add… only moves when a tag is added.
  tags: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing['--space-1-5'],
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  person: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
  },
})
