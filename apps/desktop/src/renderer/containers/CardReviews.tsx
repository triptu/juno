import type { HomeItem, HomeTopic, UndoCommand } from '@juno/contract'
import { actOnDoneFollowUp, actOnOldDraft, registry } from '@juno/state'
import { DoneFollowUpsReview, OldDraftsReview, SheetLayer } from '@juno/views'
import { openSettings, openTopic } from './navigation'
import { useReview } from './useReview'

interface CardReviewProps {
  readonly item: HomeItem
  readonly now: number
  readonly onClose: (allDone: boolean) => void
}

/**
 * The review of follow-ups that look done, or of old drafts, in a sheet:
 * the action and the "no" per row, each with its toast, and Undo on the
 * row. Opening a topic closes the sheet; ⌘ opens it in a new tab and
 * keeps the review. Closing it with nothing left open retires Home's row.
 */
export function CardReview({ item, now, onClose }: CardReviewProps) {
  const { statuses, statusOf, act, undo } = useReview()
  const open = item.topics.filter((topic) => statusOf(topic.id) === 'open')
  const close = () => onClose(open.length === 0)
  const run = (id: string, yes: boolean) => {
    const topic = item.topics.find((candidate) => candidate.id === id)
    if (topic === undefined) return
    const command = (topic: HomeTopic): Promise<UndoCommand | undefined> =>
      item.kind === 'oldDrafts' ? actOnOldDraft(registry, topic, yes ? 'delete' : 'keep') : actOnDoneFollowUp(registry, topic, yes ? 'done' : 'notDone')
    void act(id, yes ? 'done' : 'declined', () => command(topic))
  }
  const props = {
    topics: item.topics,
    statuses,
    now,
    autoFocus: true,
    onOpen: (topicId: string, event: { readonly metaKey: boolean }) => {
      if (!event.metaKey) close()
      openTopic(topicId, { newTab: event.metaKey })
    },
    onAct: (id: string) => run(id, true),
    onDecline: (id: string) => run(id, false),
    onUndo: (id: string) => void undo(id),
    onSettings: () => {
      close()
      openSettings('tidy-up')
    },
    onClose: close,
  }
  return <SheetLayer onClose={close}>{item.kind === 'oldDrafts' ? <OldDraftsReview {...props} /> : <DoneFollowUpsReview {...props} />}</SheetLayer>
}
