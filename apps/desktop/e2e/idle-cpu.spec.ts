// The engine sleeps when nothing happens (performance.md section 1, "Idle
// CPU after sync"). The workspace holds what made it spin on 10-16: an
// unread message that mentions someone the store knows, under a newer one
// that names nobody. Here #eng is small, so that spin cost little; the
// engine test `idle.test.ts` reads a large channel and catches it.
import type { FakeSlack } from '@juno/fake-slack'
import { expect, hooks, test } from './fixtures'

/** performance.md, "Idle CPU": the engine's share of one core while idle after sync. */
const IDLE_CPU_BUDGET_PERCENT = 3
const IDLE_WINDOW_MS = 20_000

/** Maya in #eng, with a real mention of Leo (a rich_text `user` element), as Slack sends one. */
const mentionLeo = (fake: FakeSlack, channel: string) =>
  fake.workspace.post({
    channel,
    user: 'U0MAYA',
    mrkdwn: true,
    text: '<@U0LEO> can you look at the rollout plan?',
    blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'user', user_id: 'U0LEO' }, { type: 'text', text: ' can you look at the rollout plan?' }] }] }],
  } as Parameters<FakeSlack['workspace']['post']>[0])

test('the engine is idle after sync, with an older unread message that mentions a known person', async ({ juno, slack, app, fake }) => {
  test.setTimeout(120_000)
  await juno.signIn()
  await juno.sidebar.expectRows()
  await juno.expectEngineLive()
  mentionLeo(fake, slack.channel('eng'))
  slack.as('Maya').postIn('eng', 'thanks, no rush')
  await expect(juno.sidebar.row('#eng').root).toContainText('thanks, no rush')

  const engine = await hooks(app, 'enginePid')
  expect(engine).toBeDefined()
  const cpu = () => app.evaluate(({ app }, pid) => app.getAppMetrics().find((metric) => metric.pid === pid)?.cpu.percentCPUUsage, engine)
  // Let the events settle, then take a sample: `percentCPUUsage` is the share since the previous call.
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  await cpu()
  await new Promise((resolve) => setTimeout(resolve, IDLE_WINDOW_MS))
  const idle = await cpu()
  test.info().annotations.push({ type: 'idle cpu', description: `engine ${idle?.toFixed(1)} % of one core over ${IDLE_WINDOW_MS / 1000} s` })
  expect(idle).toBeDefined()
  expect(idle!).toBeLessThan(IDLE_CPU_BUDGET_PERCENT)
})
