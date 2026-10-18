import type { MediaDevice } from './types.ts'

/** Chromium's ids for the device that follows the system. */
const SYSTEM_IDS = new Set(['default', 'communications'])

/**
 * Chromium's device list as the menu needs it: the real devices, and the
 * system device's name from its "Default - …" entry.
 */
export function deviceList(infos: ReadonlyArray<MediaDeviceInfo>): { readonly devices: ReadonlyArray<MediaDevice>; readonly system: string } {
  const system = infos.find((d) => d.deviceId === 'default')?.label.replace(/^Default - /, '') ?? ''
  const devices = infos.filter((d) => !SYSTEM_IDS.has(d.deviceId) && d.deviceId !== '').map((d) => ({ id: d.deviceId, label: d.label }))
  return { devices, system }
}

/** The pick if it is connected, else the system's (`null`). */
export function inUse(pick: string | null, devices: ReadonlyArray<MediaDevice>): string | null {
  return pick !== null && devices.some((d) => d.id === pick) ? pick : null
}
