import { expect, it } from 'vitest'
import { createDockBadge } from '../src/main/dockBadge'
import type { NotificationPermission } from '@juno/contract'

it('waits for a post-setup view and persists a denied request across a relaunch', async () => {
  let requests = 0
  let asked = false
  const permission = {
    read: async (): Promise<NotificationPermission> => ({ authorization: 'notDetermined', badges: 'unknown' }),
    request: async (): Promise<NotificationPermission> => { requests += 1; return { authorization: 'denied', badges: 'disabled' } },
  }
  const automatic = { enabled: true, asked: () => asked, remember: async () => { asked = true } }
  const first = createDockBadge(permission, () => {}, automatic)
  first.set('•')
  expect(requests).toBe(0)
  await first.contentShown()
  expect(requests).toBe(1)
  expect(asked).toBe(true)
  const relaunched = createDockBadge(permission, () => {}, automatic)
  relaunched.set('•')
  await relaunched.contentShown()
  expect(requests).toBe(1)
})

it('never prompts automatically in development, but the Allow action still asks', async () => {
  let requests = 0
  const permission = {
    read: async (): Promise<NotificationPermission> => ({ authorization: 'notDetermined', badges: 'unknown' }),
    request: async (): Promise<NotificationPermission> => { requests += 1; return { authorization: 'allowed', badges: 'enabled' } },
  }
  const dock = createDockBadge(permission, () => {}, { enabled: false, asked: () => false, remember: async () => {} })
  dock.set('•')
  await dock.contentShown()
  expect(requests).toBe(0)
  await dock.request()
  expect(requests).toBe(1)
})
