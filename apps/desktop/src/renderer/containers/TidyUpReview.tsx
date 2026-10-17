import type { HomeItem } from '@juno/contract'
import { actOnSettled, registry, resolveAllTopics } from '@juno/state'
import { SettledReview, SheetLayer } from '@juno/views'
import { openSettings, openTopic } from './navigation'
import { useReview } from './useReview'

/**
 * Tidy up's review in a sheet: Resolve and Keep open per row, each with
 * the usual toast, and Undo on the row itself, which puts back just that
 * topic. Opening a topic closes the sheet; ⌘ opens it in a new tab and
 * keeps the review. Closing it with nothing left open retires Home's row.
 */
export function TidyUpReview({ item, now, onClose }: { readonly item: HomeItem; readonly now: number; readonly onClose: (allDone: boolean) => void }) {
  const { statuses, statusOf, act, undo, actedTogether } = useReview()
  const open = item.topics.filter((topic) => statusOf(topic.id) === 'open')
  const run = (id: string, action: 'resolve' | 'keep') => {
    const topic = item.topics.find((candidate) => candidate.id === id)
    if (topic !== undefined) void act(id, action === 'resolve' ? 'done' : 'declined', () => actOnSettled(registry, topic, action))
  }
  const resolveRest = async () => {
    const ids = open.map((topic) => topic.id)
    const finish = actedTogether(ids, 'done')
    const restores = await resolveAllTopics(registry, ids)
    finish(restores.map((restore) => [restore.id, restore] as const))
  }
  const close = () => onClose(open.length === 0)
  return (
    <SheetLayer onClose={close}>
      <SettledReview
        topics={item.topics}
        statuses={statuses}
        now={now}
        autoFocus
        onOpen={(topicId, event) => {
          if (!event.metaKey) close()
          openTopic(topicId, { newTab: event.metaKey })
        }}
        onAct={(id) => run(id, 'resolve')}
        onDecline={(id) => run(id, 'keep')}
        onUndo={(id) => void undo(id)}
        onAll={() => void resolveRest()}
        onSettings={() => {
          close()
          openSettings('tidy-up')
        }}
        onClose={close}
      />
    </SheetLayer>
  )
}
