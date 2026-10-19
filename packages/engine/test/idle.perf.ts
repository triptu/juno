import { productionTiming } from '../src/config'
// The engine sleeps when nothing happens (performance.md section 1, "Idle
// CPU after sync"). On 10-16 it spun at 103 % on a large workspace: an
// unread message mentioned someone the store knew, a newer one named nobody,
// and the topic's re-index asked for that person again every 50 ms. A large
// channel makes each re-index cost what it did there.
import { afterEach, expect, it } from 'vitest'
import type { FakeSlack } from '@juno/fake-slack'
import { sleep, startTestEngine, type RunningEngine } from './harness'

/** performance.md section 1: under 3 % of one core while idle. The spin above cost about 7 % here. */
const IDLE_CPU_BUDGET_PERCENT = 2
const HISTORY = 3_000

let engine: RunningEngine | undefined
afterEach(async () => {
  await engine?.stop()
  engine = undefined
})

const channelNamed = (fake: FakeSlack, name: string): string => {
  for (const [id, conversation] of fake.workspace.conversations) if (conversation.name === name) return id
  throw new Error(`No channel #${name}`)
}

it('sleeps after sync, with an older unread message that mentions a known person [production timing]', async () => {
  engine = await startTestEngine({
    timing: { ...productionTiming, sweepIntervalMillis: 0, followPassMillis: 0 },
    initial: (fake) => {
      const eng = channelNamed(fake, 'eng')
      const now = fake.workspace.clock.now()
      for (let i = 0; i < HISTORY; i++) fake.workspace.post({ channel: eng, user: 'U0SAM', text: `Status note ${i}`, at: now - 6 * 60 * 60 * 1000 + i * 1000, silent: true })
      return fake.signIn()
    },
  })
  await engine.phase('live')
  await engine.syncIdle()
  const eng = channelNamed(engine.fake, 'eng')
  engine.fake.workspace.post({
    channel: eng,
    user: 'U0MAYA',
    mrkdwn: true,
    text: '<@U0LEO> can you look at the rollout plan?',
    blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'user', user_id: 'U0LEO' }, { type: 'text', text: ' can you look at the rollout plan?' }] }] }],
  } as Parameters<FakeSlack['workspace']['post']>[0])
  engine.fake.workspace.post({ channel: eng, user: 'U0MAYA', text: 'thanks, no rush' })
  await engine.rowsUntil((rows) => rows.some((row) => row.preview.text === 'thanks, no rush'), 'the newer message in #eng')
  await sleep(2_000)

  // The engine runs in this process, beside the fake, which is idle too.
  const before = process.cpuUsage()
  const started = performance.now()
  await sleep(5_000)
  const used = process.cpuUsage(before)
  const percent = ((used.user + used.system) / 1000 / (performance.now() - started)) * 100
  expect(percent).toBeLessThan(IDLE_CPU_BUDGET_PERCENT)
})
