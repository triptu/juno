import { useState } from 'react'
import { type About, type Place, type SendContext } from '@juno/agent-contract'
import type { TopicDetail } from '@juno/contract'
import { junoAboutAtom, junoPanelViewAtom, openedAtNewAtom, registry, topicAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { JunoHeader, JunoPanelActions, JunoPanelContext, type PanelPlace } from '@juno/views'
import { showJunoPanelView } from '../navigation'
import { closeJunoPanel, moveJunoToTab, resumeJuno } from './actions'
import { JunoPageView } from './JunoPageView'
import { JunoChat } from './JunoChat'
import { NoProviderFrame, useNoProvider } from './NoProviderFrame'
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

/** The context line's words: "eng · Main" or "eng · Postgres 16 migration plan", after the kind icon that stands for the "#". */
const panelPlaceOf = (detail: TopicDetail): PanelPlace => ({ tint: detail.channel.tint, label: `${detail.channel.name} · ${detail.kind === 'main' ? 'Main' : detail.title}` })

/**
 * The Juno panel beside a topic (SPEC 7, inventory 12.1): the same single
 * chat, opened at the bottom. A message sent from it carries the topic, the
 * messages on screen, the "new" divider and the selection, or the About
 * chip's person or channel instead. The chip and the draft belong to the
 * tab, so they wait there while the panel shows in another tab.
 */
export function JunoPanel({ tabId, topicId }: { readonly tabId: string; readonly topicId: string }) {
  const view = useAtomValue(junoPanelViewAtom(tabId))
  if (useNoProvider()) return <NoProviderFrame column="panel" actions={<JunoPanelActions onOpenInTab={moveJunoToTab} onClose={close} />} />
  // The header's switcher shows a Juno page in the panel, in place, beside the topic (SPEC 13.10).
  if (view !== 'chat') return <JunoPageView view={view} column="panel" onSwitch={(target) => showJunoPanelView(tabId, target)} actions={<JunoPanelActions onOpenInTab={moveJunoToTab} onClose={close} />} />
  return <PanelChat tabId={tabId} topicId={topicId} />
}

function PanelChat({ tabId, topicId }: { readonly tabId: string; readonly topicId: string }) {
  const result = useAtomValue(topicAtom(topicId))
  const detail = result._tag === 'Success' ? (result.value ?? undefined) : undefined
  const about = useAtomValue(junoAboutAtom(tabId))
  const newFrom = useAtomValue(openedAtNewAtom(topicId))
  const [selection, clearSelection] = useTopicSelection(topicId)
  const [menuOpen, setMenuOpen] = useState(false)

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
    clearSelection()
  }

  return (
    <JunoChat
      column="panel"
      draftKey={`panel:${tabId}`}
      onOpenPage={(page) => showJunoPanelView(tabId, page)}
      header={(banner) => (
        <JunoHeader
          column="panel"
          banner={banner}
          menuOpen={menuOpen}
          onMenu={setMenuOpen}
          current="chat"
          onOpenPage={(target) => showJunoPanelView(tabId, target)}
          onResume={resumeJuno}
          actions={<JunoPanelActions onOpenInTab={moveJunoToTab} onClose={close} />}
        />
      )}
      contextOf={contextOf}
      onSent={onSent}
      onEscape={close}
      composerContext={
        <JunoPanelContext
          {...(detail === undefined ? {} : { place: panelPlaceOf(detail) })}
          {...(selection === undefined ? {} : { selection, onRemoveSelection: clearSelection })}
          {...(about === undefined ? {} : { about, onRemoveAbout: () => registry.set(junoAboutAtom(tabId), undefined) })}
        />
      }
    />
  )
}
