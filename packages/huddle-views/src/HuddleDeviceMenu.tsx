import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { OptionGroupLabel, OptionList, OptionRow, OptionSeparator, useMenuActive } from '@juno/ui'
import type { HuddleDevice } from './model'

/** The "Same as system" choice; a device's own id otherwise. */
export const systemDevice = 'system'

export interface HuddleDeviceMenuProps {
  /** The devices macOS lists, without the system choice. */
  readonly microphones: ReadonlyArray<HuddleDevice>
  readonly speakers: ReadonlyArray<HuddleDevice>
  /** What the system uses now, named in the first row: "MacBook Pro Microphone". */
  readonly systemMicrophone: string
  readonly systemSpeaker: string
  /** The chosen ids, or `systemDevice`. */
  readonly microphone: string
  readonly speaker: string
  /** Reduce background noise (Voice Focus). */
  readonly noiseReduction: boolean
  readonly onMicrophone: (id: string) => void
  readonly onSpeaker: (id: string) => void
  readonly onNoiseReduction: (on: boolean) => void
}

/**
 * What Microphone and speaker opens (SPEC 20): the microphones, the
 * speakers, each led by "Same as system", then Reduce background noise. A
 * check marks each current choice, as a Mac pop-up menu does; a pick
 * applies at once.
 */
export function HuddleDeviceMenu({
  microphones,
  speakers,
  systemMicrophone,
  systemSpeaker,
  microphone,
  speaker,
  noiseReduction,
  onMicrophone,
  onSpeaker,
  onNoiseReduction,
}: HuddleDeviceMenuProps) {
  const mics = [{ id: systemDevice, name: `Same as system (${systemMicrophone})` }, ...microphones]
  const outs = [{ id: systemDevice, name: `Same as system (${systemSpeaker})` }, ...speakers]
  const ids = [...mics.map((device) => `mic:${device.id}`), ...outs.map((device) => `out:${device.id}`), 'noise']
  const pick = (id: string) => {
    if (id === 'noise') onNoiseReduction(!noiseReduction)
    else if (id.startsWith('mic:')) onMicrophone(id.slice('mic:'.length))
    else onSpeaker(id.slice('out:'.length))
  }
  const menu = useMenuActive(ids, pick)
  return (
    <div {...stylex.props(styles.root)}>
      <OptionList role="menu" label="Microphone and speaker" {...menu.list}>
        <OptionGroupLabel>Microphone</OptionGroupLabel>
        {mics.map((device) => (
          <OptionRow key={device.id} {...menu.row(`mic:${device.id}`)} label={device.name} selected={device.id === microphone} onSelect={() => onMicrophone(device.id)} />
        ))}
        <OptionGroupLabel>Speaker</OptionGroupLabel>
        {outs.map((device) => (
          <OptionRow key={device.id} {...menu.row(`out:${device.id}`)} label={device.name} selected={device.id === speaker} onSelect={() => onSpeaker(device.id)} />
        ))}
        <OptionSeparator />
        <OptionRow {...menu.row('noise')} label="Reduce background noise" selected={noiseReduction} onSelect={() => onNoiseReduction(!noiseReduction)} />
      </OptionList>
    </div>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
  },
})
