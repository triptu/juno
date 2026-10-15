import { expect, it } from 'vitest'
import { reply } from '@juno/agent-testing'
import { turnsHarness, say } from './turns-harness'

it('stores offline input without a model request and sends once after the socket returns', async () => {
  let online = false
  const h = await turnsHarness({ online: () => online, compaction: false })
  try {
    h.fake.script([reply(say('Back online.'))])
    const op = h.send('Hold this for the network')
    await h.turns.idle()
    expect(h.turns.op(op)?.state).toBe('accepted')
    expect(h.chatRequests()).toEqual([])
    online = true
    h.turns.networkChanged()
    h.turns.networkChanged()
    await h.turns.idle()
    expect(h.turns.op(op)?.state).toBe('done')
    expect(h.chatRequests()).toHaveLength(1)
  } finally { await h.close() }
})
