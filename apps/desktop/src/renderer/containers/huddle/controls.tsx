/**
 * What the bar and the tab share: the controls' state and actions, the
 * device menu and the ticking duration.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { MediaSnapshot } from '@juno/huddle-media'
import { HuddleDeviceMenu, systemDevice, type HuddleControlsActions, type HuddleControlsState } from '@juno/huddle-views'
import { chooseMicrophone, chooseSpeaker, leaveCurrentHuddle, refreshDevices, setNoiseSuppression, toggleHuddleMuted } from './media'

export interface Controls extends HuddleControlsState, HuddleControlsActions {
  readonly devices: ReactNode
}

/** The controls for the call, with the device menu open or closed locally. */
export function useHuddleControls(media: MediaSnapshot | undefined): Controls {
  const [devicesOpen, setDevicesOpen] = useState(false)
  const micBlocked = media?.microphoneAccess === 'denied' || media?.microphoneAccess === 'unavailable'
  return {
    muted: media?.local.muted ?? false,
    ...(micBlocked ? { micBlocked: true } : {}),
    sharing: false,
    devicesOpen,
    onMute: toggleHuddleMuted,
    onDevices: (open) => {
      if (open) void refreshDevices()
      setDevicesOpen(open)
    },
    onLeave: leaveCurrentHuddle,
    devices: devicesOpen && media !== undefined ? <DeviceMenu media={media} /> : null,
  }
}

function DeviceMenu({ media }: { readonly media: MediaSnapshot }) {
  const { devices } = media
  return (
    <HuddleDeviceMenu
      microphones={devices.microphones.map((device) => ({ id: device.id, name: device.label }))}
      speakers={devices.speakers.map((device) => ({ id: device.id, name: device.label }))}
      systemMicrophone={devices.systemMicrophone}
      systemSpeaker={devices.systemSpeaker}
      microphone={devices.microphone ?? systemDevice}
      speaker={devices.speaker ?? systemDevice}
      noiseReduction={media.noiseSuppression === 'on'}
      onMicrophone={(id) => chooseMicrophone(id === systemDevice ? null : id)}
      onSpeaker={(id) => chooseSpeaker(id === systemDevice ? null : id)}
      onNoiseReduction={setNoiseSuppression}
    />
  )
}

/** "4:05", "1:02:33": how long the huddle has run, counted from its start. */
export function formatDuration(millis: number): string {
  const total = Math.max(0, Math.floor(millis / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** A leaf that ticks once a second, so nothing else re-renders for the clock. */
export function Duration({ startedAt }: { readonly startedAt: number | null }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  return <>{formatDuration(now - (startedAt ?? now))}</>
}
