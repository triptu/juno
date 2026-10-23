// Where a Slack link in a message goes (spec section 8, "Links"): the topic
// `messages.locate` names for a message, with the conversation's label for
// the link's hover text, and the DM `people.locate` finds for a person.
import { afterEach, describe, expect, it } from 'bun:test'
import { locateMessage, locatePerson } from '@juno/state'
import type { RunningEngine } from './harness'
import { bootedEngine as boot, quiet, valueOf } from './scenario'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const bootedEngine = async () => {
  const engine = await boot(engines)
  await quiet(engine)
  return engine
}

describe('locating a link', () => {
  it('takes the thread a link names, even for a reply the store does not have', async () => {
    const engine = await bootedEngine()
    expect(valueOf(await locateMessage(engine.registry, 'C0ENG', '2.000002', '1.000001'))).toEqual({ topicId: 't:C0ENG:1.000001', stored: false, place: '#eng' })
  })

  it('names a DM by the person and leaves out a conversation the store does not know', async () => {
    const engine = await bootedEngine()
    expect(valueOf(await locateMessage(engine.registry, 'D0MAYA', '1.000001')).place).toBe('Maya Chen')
    expect(valueOf(await locateMessage(engine.registry, 'C0NOWHERE', '1.000001'))).toEqual({ topicId: 'm:C0NOWHERE', stored: false })
  })

  it('finds a person and your DM with them', async () => {
    const engine = await bootedEngine()
    const maya = valueOf(await locatePerson(engine.registry, 'U0MAYA'))
    expect(maya.person?.name).toBe('Maya Chen')
    expect(maya.mainId).toBe('m:D0MAYA')
    expect(valueOf(await locatePerson(engine.registry, 'U0NOBODY'))).toEqual({})
  })
})
