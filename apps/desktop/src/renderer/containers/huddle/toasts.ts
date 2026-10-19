/**
 * The toasts a call's end shows (SPEC 20, "When things go wrong"). The
 * user's own Leave shows none.
 */
import type { HuddleCall, HuddleEnd } from '@juno/contract'
import { huddleCallValueAtom, registry, showToast, type ToastContent } from '@juno/state'

const turnedOff = (code: string | undefined) => code === 'feature_not_enabled' || code === 'huddles_disabled'

function toastFor(ended: HuddleEnd, join: (channelId: string) => void): ToastContent | undefined {
  const again = (label: string) => ({ action: { label, onAction: () => join(ended.channelId) } })
  switch (ended.reason) {
    case 'anotherDevice':
      return { text: 'You joined this huddle on another device', ...again('Join here') }
    case 'connectionLost':
      return { text: 'Lost the connection to the huddle', ...again('Rejoin') }
    case 'ended':
      return { text: 'The huddle ended' }
    case 'joinFailed':
      return { text: "Couldn't join the huddle", ...(turnedOff(ended.code) ? {} : again('Try again')) }
    case 'failed':
      return { text: 'Lost the connection to the huddle', ...again('Rejoin') }
    case 'left':
      return undefined
  }
}

/** Shows a toast each time a call the user was in, or joining, ends by itself. */
export function watchHuddleEnds(join: (channelId: string) => void): void {
  let previous: HuddleCall | undefined
  registry.subscribe(huddleCallValueAtom, (call) => {
    const was = previous
    previous = call
    if (call === undefined || was === undefined || was.phase === 'idle' || call.phase !== 'idle' || call.ended === null) return
    const toast = toastFor(call.ended, join)
    if (toast !== undefined) showToast(registry, toast)
  })
}
