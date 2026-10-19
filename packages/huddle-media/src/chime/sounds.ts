/** The call sounds' playback (SPEC 20, "Sounds"); `../sounds.ts` decides when. */
import type { HuddleSound } from '../sounds.ts'

/** The call sounds' urls, bundled with the app. A sound without one plays nothing. */
export type SoundUrls = Partial<Record<HuddleSound, string>>

/** Call sounds play at this volume, so they stay quiet under the call. */
const SOUND_VOLUME = 0.5
const noop = () => {}

/** Plays `url` once on `speaker`, or on the system's speaker for null. Never throws. */
export function playSoundUrl(url: string | undefined, speaker: string | null): void {
  if (url === undefined) return
  const audio = new Audio(url)
  audio.volume = SOUND_VOLUME
  void audio
    .setSinkId(speaker ?? '')
    .catch(noop)
    .then(() => audio.play())
    .catch(noop)
}
