import type { HomeItem, HomeTopic, UndoCommand } from '@juno/contract'
import { actOnDoneFollowUp, actOnMove, actOnOldDraft, actOnSettled, actOnSuggested, registry, resolveAllTopics } from '@juno/state'
import { AutomatedReview, DoneFollowUpsReview, IgnoreReview, movedToast, OldDraftsReview, SettledReview, SheetLayer, UnfollowReview } from '@juno/views'
import { openSettings, openTopic } from './navigation'
import { useReview } from './useReview'

/** What a card's two buttons run on one row, resolving with the undo, or undefined when nothing changed. */
function runFor(item: HomeItem): (topic: HomeTopic, yes: boolean) => Promise<UndoCommand | undefined> {
  switch (item.kind) {
    case 'tidyUp':
      return (topic, yes) => actOnSettled(registry, topic, yes ? 'resolve' : 'keep')
    case 'automatedMoves':
      return (topic, yes) => actOnMove(registry, topic, yes ? 'act' : 'keep', movedToast(topic, yes ? 'act' : 'keep'))
    case 'oldDrafts':
      return (topic, yes) => actOnOldDraft(registry, topic, yes ? 'delete' : 'keep')
    case 'unfollow':
    case 'ignore':
      return (topic, yes) => actOnSuggested(registry, item.kind === 'unfollow' ? 'unfollow' : 'ignore', topic, yes ? 'act' : 'keep')
    case 'doneFollowUps':
      return (topic, yes) => actOnDoneFollowUp(registry, topic, yes ? 'done' : 'notDone')
    default:
      // Not a review card: no row of it can be acted on.
      return () => Promise.resolve(undefined)
  }
}

/**
 * A Home card's review in a sheet (`ReviewSheet`; SPEC 12): Tidy up,
 * Automated's record, follow-ups that look done, old drafts, threads you
 * never open (Unfollow) or channels you never read (Ignore). The action
 * and the "no" per row, each with the usual toast, and Undo on the row
 * itself, which puts back just that row (`useReview`); Tidy up adds
 * Resolve all. Opening a topic closes the sheet; ⌘ opens it in a new tab
 * and keeps the review. Closing it with nothing left open retires Home's row.
 */
export function HomeReview({ item, now, onClose }: { readonly item: HomeItem; readonly now: number; readonly onClose: (allDone: boolean) => void }) {
  const { statuses, statusOf, act, undo, actedTogether } = useReview()
  const open = item.topics.filter((topic) => statusOf(topic.id) === 'open')
  const close = () => onClose(open.length === 0)
  const run = runFor(item)
  const answer = (id: string, yes: boolean) => {
    const topic = item.topics.find((candidate) => candidate.id === id)
    if (topic !== undefined) void act(id, yes ? 'done' : 'declined', () => run(topic, yes))
  }
  const resolveRest = async () => {
    const ids = open.map((topic) => topic.id)
    const finish = actedTogether(ids, 'done')
    const restores = await resolveAllTopics(registry, ids)
    finish(restores.map((restore) => [restore.id, restore] as const))
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
    onAct: (id: string) => answer(id, true),
    onDecline: (id: string) => answer(id, false),
    onUndo: (id: string) => void undo(id),
    onSettings: () => {
      close()
      openSettings('tidy-up')
    },
    onClose: close,
  }
  const sheet =
    item.kind === 'tidyUp' ? (
      <SettledReview {...props} onAll={() => void resolveRest()} />
    ) : item.kind === 'automatedMoves' ? (
      <AutomatedReview {...props} title={item.title} />
    ) : item.kind === 'oldDrafts' ? (
      <OldDraftsReview {...props} />
    ) : item.kind === 'unfollow' ? (
      <UnfollowReview {...props} />
    ) : item.kind === 'ignore' ? (
      <IgnoreReview {...props} />
    ) : item.kind === 'doneFollowUps' ? (
      <DoneFollowUpsReview {...props} />
    ) : null
  return sheet === null ? null : <SheetLayer onClose={close}>{sheet}</SheetLayer>
}
