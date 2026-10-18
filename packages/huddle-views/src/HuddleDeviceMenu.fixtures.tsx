import { defineFixtures, fixture } from '@juno/ui'
import { noop } from './fixtures/data'
import { HuddleDeviceMenu, systemDevice, type HuddleDeviceMenuProps } from './HuddleDeviceMenu'

const base: HuddleDeviceMenuProps = {
  microphones: [
    { id: 'mic-builtin', name: 'MacBook Pro Microphone' },
    { id: 'mic-airpods', name: 'AirPods Pro' },
    { id: 'mic-usb', name: 'Shure MV7+' },
  ],
  speakers: [
    { id: 'out-builtin', name: 'MacBook Pro Speakers' },
    { id: 'out-airpods', name: 'AirPods Pro' },
    { id: 'out-display', name: 'Studio Display Speakers' },
  ],
  systemMicrophone: 'MacBook Pro Microphone',
  systemSpeaker: 'MacBook Pro Speakers',
  microphone: systemDevice,
  speaker: systemDevice,
  noiseReduction: true,
  onMicrophone: noop,
  onSpeaker: noop,
  onNoiseReduction: noop,
}

/** The menu as the bar and the tab pass it, for their own fixtures. */
export const deviceMenu = (props: Partial<HuddleDeviceMenuProps> = {}) => <HuddleDeviceMenu {...base} {...props} />

export default defineFixtures(
  HuddleDeviceMenu,
  {
    Devices: {
      'same as system': fixture(base),
      'chosen devices': fixture({ ...base, microphone: 'mic-airpods', speaker: 'out-airpods' }),
      'noise reduction off': fixture({ ...base, noiseReduction: false }),
      'built-in only': fixture({ ...base, microphones: base.microphones.slice(0, 1), speakers: base.speakers.slice(0, 1) }),
      'long names': fixture({
        ...base,
        microphones: [...base.microphones, { id: 'mic-long', name: 'Elgato Wave XLR (USB Audio Interface, 48 kHz)' }],
        microphone: 'mic-long',
      }),
    },
  },
  { width: 300, surface: 'raised' },
)
