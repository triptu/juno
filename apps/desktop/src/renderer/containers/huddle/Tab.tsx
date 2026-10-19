/**
 * The huddle tab (SPEC 20), a lazy chunk. It shows the huddle as it is now:
 * the controls while the user is in it, Join or Switch while it runs
 * without them, and the ended or failed page after.
 */
import { mainTopicOf, threadTopicOf, type HuddleCall, type RunningHuddle } from '@juno/contract'
import { HuddlePage, type HuddlePageState } from '@juno/huddle-views'
import { huddleCallValueAtom, huddleInChannelAtom, huddleLastRunAtom, type HuddleLastRun } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { openTopic } from '../navigation'
import { Duration, useHuddleControls } from './controls'
import { connectionOf, placeOf, useHuddleChannel, useHuddlePeople, useMediaSnapshot, useSelfId } from './look'
import { joinHuddle } from './media'

/** "24 minutes", "1 minute", "less than a minute". */
function lastedOf(millis: number): string {
  const minutes = Math.round(millis / 60_000)
  return minutes < 1 ? 'less than a minute' : minutes === 1 ? '1 minute' : `${minutes} minutes`
}

function failureOf(code: string | undefined): string {
  if (code === 'huddle_full' || code === 'call_full') return 'This huddle is full.'
  if (code === 'feature_not_enabled' || code === 'huddles_disabled') return 'Huddles are turned off in this workspace. A workspace admin can turn them on.'
  return "Slack didn't answer. Try again in a moment."
}

const retryable = (code: string | undefined) => code !== 'feature_not_enabled' && code !== 'huddles_disabled'

export function HuddleTab({ channelId, tabId }: { readonly channelId: string; readonly tabId: string }) {
  const call = useAtomValue(huddleCallValueAtom)
  const running = useAtomValue(huddleInChannelAtom(channelId))
  const detail = useHuddleChannel(channelId)
  const media = useMediaSnapshot()
  const selfId = useSelfId()
  const controls = useHuddleControls(media)
  const inThis = call !== undefined && call.channelId === channelId && (call.phase === 'joining' || call.phase === 'joined')
  const people = useHuddlePeople(inThis ? call.participants : running?.participants ?? [], selfId, media, inThis)
  const lastRun = useAtomValue(huddleLastRunAtom(channelId))
  const threadTs = running?.threadTs ?? null
  return (
    <HuddlePage
      place={placeOf(detail)}
      state={stateOf(call, running, inThis, controls, channelId, lastRun)}
      people={people}
      onPlace={() => openTopic(mainTopicOf(channelId))}
      {...(threadTs === null ? {} : { onOpenThread: () => openTopic(threadTopicOf(channelId, threadTs), { newTab: true, after: tabId }) })}
      devices={controls.devices}
    />
  )

  function stateOf(
    current: HuddleCall | undefined,
    here: RunningHuddle | undefined,
    joined: boolean,
    actions: ReturnType<typeof useHuddleControls>,
    channel: string,
    times: HuddleLastRun | undefined,
  ): HuddlePageState {
    const duration = <Duration startedAt={here?.startedAt ?? current?.startedAt ?? null} />
    if (joined && current !== undefined) {
      const { devices: _devices, ...rest } = actions
      return { kind: 'in', connection: connectionOf(current, media), duration, ...rest }
    }
    const switching = current !== undefined && (current.phase === 'joining' || current.phase === 'joined')
    if (here !== undefined) return { kind: 'out', duration, ...(switching ? { switching: true } : {}), onJoin: () => void joinHuddle(channel) }
    const ended = current?.ended
    if (ended?.channelId === channel && ended.reason === 'joinFailed') {
      return { kind: 'failed', reason: failureOf(ended.code), ...(retryable(ended.code) ? { onRetry: () => void joinHuddle(channel) } : {}) }
    }
    if (times?.endedAt != null) return { kind: 'ended', lasted: lastedOf(times.endedAt - times.startedAt) }
    // Nothing runs here and Juno did not see it run: Join starts one.
    return { kind: 'out', duration, ...(switching ? { switching: true } : {}), onJoin: () => void joinHuddle(channel) }
  }
}
