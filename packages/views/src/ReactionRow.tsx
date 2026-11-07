import * as stylex from '@stylexjs/stylex'
import { memo, useId } from 'react'
import type { ReactionRow as ReactionRowModel } from '@juno/contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, AvatarStack, Emoji, focusRing, Text, type ActivateEvent } from '@juno/ui'
import { stackPerson } from './look'
import { PlaceGlyph, topicRowStyles as look } from './TopicRow'

export interface ReactionRowProps {
  /** The row as the engine shaped it. */
  readonly row: ReactionRowModel
  /** When the latest reaction came, already formatted ("12m"). */
  readonly time: string
  /** Roving tabindex: the one row that Tab reaches. */
  readonly tabbable?: boolean
  /** Fires on mouse down, or Enter; `event.metaKey` asks for a new tab. */
  readonly onOpen: (id: string, event: ActivateEvent) => void
}

/**
 * One row of the sidebar's Reactions view (SPEC 5, "Reactions"), drawn
 * with the topic row's look and three lines: who reacted, at most two
 * faces and their names with "+N" for the rest, then their emoji; the
 * message's first words, muted, as message text that privacy mode blurs;
 * and where it is, with the thread's title for a reply. The time shows
 * over the end of line one while the row is hovered or focused, as on a
 * topic row. No counts and no dot.
 */
export const ReactionRow = memo(function ReactionRow({ row, time, tabbable = true, onOpen }: ReactionRowProps) {
  const whoId = useId()
  const previewId = useId()
  const placeId = useId()
  return (
    <div
      role="listitem"
      tabIndex={tabbable ? 0 : -1}
      aria-labelledby={whoId}
      aria-describedby={`${previewId} ${placeId}`}
      data-reaction-row=""
      data-reaction-id={row.id}
      {...activateHandlers<HTMLDivElement>((event) => onOpen(row.id, event))}
      {...stylex.props(look.row, focusRing.inset)}
    >
      <span {...stylex.props(look.body)}>
        <span {...stylex.props(look.line1)}>
          <span {...stylex.props(styles.faces)}>
            <AvatarStack people={row.reactors.map((person) => stackPerson(person))} max={2} label="" />
          </span>
          <Text variant="rowTitle" truncate id={whoId} data-row-part="title" sx={styles.who}>
            {row.who}
          </Text>
          <span {...stylex.props(styles.emoji)} data-row-part="emoji">
            {row.emoji.map((emoji) =>
              emoji.url !== undefined ? (
                <Emoji key={emoji.name} url={emoji.url} size={16} title={`:${emoji.name}:`} />
              ) : emoji.unicode !== undefined ? (
                <Emoji key={emoji.name} glyph={emoji.unicode} size={16} title={`:${emoji.name}:`} />
              ) : (
                <Text key={emoji.name} variant="meta" tone="muted">{`:${emoji.name}:`}</Text>
              ),
            )}
          </span>
          <Text variant="meta" tone="muted" numeric data-row-part="time" sx={look.time}>
            {time}
          </Text>
        </span>
        <span {...stylex.props(look.line2, look.readLine2)}>
          <Text variant="preview" tone="muted" truncate as="span" dir="auto" id={previewId} data-sensitive="" data-row-part="preview" sx={look.preview}>
            {row.preview}
          </Text>
        </span>
        <span {...stylex.props(look.line3)}>
          <span {...stylex.props(look.where)} id={placeId}>
            <span {...stylex.props(look.place)}>
              <PlaceGlyph channel={row.channel} />
              <Text variant="meta" tone="muted" truncate dir="auto" data-row-part="place">
                {row.channel.name}
              </Text>
            </span>
            {row.threadTitle === undefined ? null : (
              <Text variant="meta" tone="muted" truncate dir="auto" data-row-part="thread" data-sensitive={row.threadTitleSensitive === true ? '' : undefined} sx={styles.thread}>
                {row.threadTitle}
              </Text>
            )}
          </span>
        </span>
      </span>
    </div>
  )
})

const styles = stylex.create({
  faces: {
    display: 'inline-flex',
    flexShrink: 0,
  },
  // The names give way to the emoji, which always show whole.
  who: {
    flexShrink: 1,
    minWidth: 0,
  },
  emoji: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
    flexShrink: 0,
  },
  thread: {
    flexShrink: 1,
    minWidth: 0,
  },
})
