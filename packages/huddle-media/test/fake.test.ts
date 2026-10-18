import { describe, expect, it } from 'vitest'
import { createFakeMediaSession } from '../src/fake.ts'
import type { MediaSnapshot } from '../src/index.ts'

const MAYA = 'U0MAYA00001'
const LEO = 'U0LEO000001'

describe('the fake media session', () => {
  it('plays a call through: join, people come and go, someone speaks, the call moves to another device', async () => {
    const media = createFakeMediaSession({ microphones: [{ id: 'mic-1', label: 'USB microphone' }] })
    const seen: Array<MediaSnapshot> = []
    media.subscribe(() => seen.push(media.getSnapshot()))

    await media.join({ meeting: {}, attendee: { AttendeeId: 'me' }, microphone: 'mic-1' })
    expect(media.getSnapshot().connection).toEqual({ state: 'connected' })
    expect(media.getSnapshot().local.sending).toBe(true)
    expect(media.getSnapshot().devices.microphoneInUse).toBe('mic-1')

    const maya = media.addRemote({ userId: MAYA })
    const leo = media.addRemote({ userId: LEO, muted: true })
    expect(media.getSnapshot().remotes.map((r) => [r.userId, r.muted])).toEqual([
      [MAYA, false],
      [LEO, true],
    ])

    media.setSpeaking(maya, true)
    media.setSpeaking(leo, true)
    expect(media.getSnapshot().activeSpeaker).toBe(maya)
    expect(media.getSnapshot().remotes.map((r) => r.speaking)).toEqual([true, false])

    media.setMuted(true)
    expect(media.getSnapshot().local.muted).toBe(true)

    const quiet = media.getSnapshot()
    media.setSpeaking(leo, false)
    expect(media.getSnapshot()).toBe(quiet)

    media.setConnection('reconnecting')
    expect(media.getSnapshot().connection.state).toBe('reconnecting')
    expect(media.getSnapshot().local.sending).toBe(false)
    media.setConnection('connected')
    media.setSending(false)
    expect(media.getSnapshot().local.sending).toBe(false)

    media.removeRemote(leo)
    expect(media.getSnapshot().remotes.map((r) => r.userId)).toEqual([MAYA])

    media.end('another-device')
    expect(media.getSnapshot().connection).toMatchObject({ state: 'ended', reason: 'another-device', attendeeId: 'me' })
    expect(media.getSnapshot().remotes).toEqual([])
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('joins muted with a blocked microphone, and stays muted when access comes back', async () => {
    const media = createFakeMediaSession({ microphoneAccess: 'denied' })
    await media.join({ meeting: {}, attendee: { AttendeeId: 'me' } })
    expect(media.getSnapshot().local.muted).toBe(true)
    media.setMuted(false)
    expect(media.getSnapshot().local.muted).toBe(true)
    media.setMicrophoneAccess('granted')
    expect(media.getSnapshot().local.muted).toBe(true)
    media.setMuted(false)
    expect(media.getSnapshot().local.muted).toBe(false)
  })

  it('shows a screen share as a share, not a person', async () => {
    const media = createFakeMediaSession()
    await media.join({ meeting: {}, attendee: { AttendeeId: 'me' } })
    media.addRemote({ userId: MAYA })
    media.startShare(MAYA)
    expect(media.getSnapshot().remotes).toHaveLength(1)
    expect(media.getSnapshot().shares).toEqual([{ attendeeId: `fake-${MAYA}#content`, userId: MAYA }])
    media.stopShare(MAYA)
    expect(media.getSnapshot().shares).toEqual([])
  })
})
