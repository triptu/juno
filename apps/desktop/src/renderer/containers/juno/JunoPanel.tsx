import { useRef, useState } from 'react'
import { chatCopy, type About, type Place, type SendContext } from '@juno/agent-contract'
import type { TopicDetail } from '@juno/contract'
import { catchUpDoneAtom, junoAboutAtom, openedAtNewAtom, registry, topicAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { JunoHeader, JunoPanelActions, JunoPanelContext } from '@juno/views'
import { closeJunoPanel, moveJunoToTab, openJunoPage, resumeJuno } from './actions'
import { JunoChat } from './JunoChat'
import { focusTopicComposer, useTopicSelection, visibleRange } from './topicContext'

const kindLabels: Record<TopicDetail['channel']['kind'], string> = {
  public: 'Public channel',
  private: 'Private channel',
  im: 'Direct message',
  mpim: 'Group message',
}

/** The topic's channel as the chat contract names a place. */
export function placeOf(channel: TopicDetail['channel']): Place {
  return { channelId: channel.id, name: channel.name, kindLabel: kindLabels[channel.kind], tint: channel.tint }
}

const tintLabels: Record<Place['tint'], string> = { public: 'Public channel', private: 'Private channel', dm: 'Direct message' }

/** What a message is about while the About chip shows: its person or channel. */
export function chipContext(about: Exclude<About, { _tag: 'topic' }>): SendContext {
  return about._tag === 'person'
    ? { _tag: 'person', userId: about.userId, name: about.name }
    : { _tag: 'channel', place: { channelId: about.channelId, name: about.name, kindLabel: tintLabels[about.tint], tint: about.tint } }
}

/** Close, and focus goes back to the topic's composer. */
function close(): void {
  closeJunoPanel()
  focusTopicComposer()
}

/** The About line's title for a topic: its title, or "#eng · Main". */
const titleOf = (detail: TopicDetail) => (detail.kind === 'main' ? `${detail.channel.label} · Main` : detail.title)

/**
 * The Juno panel beside a topic (SPEC 7, inventory 12.1): the same single
 * chat, opened at the bottom. A message sent from it carries the topic, the
 * messages on screen, the "new" divider and the selection, or the About
 * chip's person or channel instead. Catch me up shows while the topic opened
 * at a "new" divider and nothing has been sent about it from here.
 */
export function JunoPanel({ topicId }: { readonly topicId: string }) {
  const result = useAtomValue(topicAtom(topicId))
  const detail = result._tag === 'Success' ? (result.value ?? undefined) : undefined
  const about = useAtomValue(junoAboutAtom)
  const newFrom = useAtomValue(openedAtNewAtom(topicId))
  const catchUpDone = useAtomValue(catchUpDoneAtom(topicId))
  const [selection, clearSelection] = useTopicSelection(topicId)
  const [menuOpen, setMenuOpen] = useState(false)
  const sendRef = useRef<((text: string) => void) | null>(null)

  const contextOf = (): SendContext | undefined => {
    if (about !== undefined) return chipContext(about)
    if (detail === undefined) return undefined
    const visible = visibleRange()
    return {
      _tag: 'topic',
      topicId,
      title: titleOf(detail),
      place: placeOf(detail.channel),
      kind: detail.kind,
      ...(visible === undefined ? {} : { visible }),
      ...(newFrom === undefined ? {} : { newFrom }),
      ...(selection === undefined ? {} : { selection }),
    }
  }

  const onSent = (context: SendContext | undefined) => {
    if (context?._tag !== 'topic') return
    registry.set(catchUpDoneAtom(topicId), true)
    clearSelection()
  }

  return (
    <JunoChat
      column="panel"
      header={(banner) => (
        <JunoHeader
          column="panel"
          banner={banner}
          menuOpen={menuOpen}
          onMenu={setMenuOpen}
          onOpenPage={openJunoPage}
          onResume={resumeJuno}
          actions={<JunoPanelActions onOpenInTab={moveJunoToTab} onClose={close} />}
        />
      )}
      contextOf={contextOf}
      onSent={onSent}
      onEscape={close}
      sendRef={sendRef}
      composerContext={
        <JunoPanelContext
          {...(selection === undefined ? {} : { selection, onRemoveSelection: clearSelection })}
          {...(about === undefined ? {} : { about, onRemoveAbout: () => registry.set(junoAboutAtom, undefined) })}
          {...(newFrom !== undefined && !catchUpDone ? { onCatchMeUp: () => sendRef.current?.(chatCopy.panel.catchMeUp) } : {})}
        />
      }
    />
  )
}
