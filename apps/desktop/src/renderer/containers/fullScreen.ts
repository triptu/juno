import { fullScreenAtom, onFullScreen, registry } from '@juno/state'

/** Follows the window into and out of full screen, where the title bars drop the traffic lights' room. Returns the unsubscribe. */
export function followFullScreen(): () => void {
  return onFullScreen((fullScreen) => registry.set(fullScreenAtom, fullScreen))
}
