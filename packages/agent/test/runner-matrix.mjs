// Five alternating samples after one warmup per setting, all on one four-core job.
import { spawnSync } from 'node:child_process'

const agent = ['test/output.test.ts', 'test/naming.test.ts', 'test/result-line.test.ts', 'test/policy.test.ts', 'test/catalog.test.ts', 'test/discovery.test.ts', 'test/actions.test.ts', 'test/turns-crash.test.ts']
const plan = []
for (let sample = 0; sample < 6; sample++) {
  for (const pool of ['forks', 'threads']) {
    for (const isolate of [true, false]) {
      if (plan.length) plan.push('+')
      plan.push('test:agent', ...agent, '--pool', pool, `--isolate=${isolate}`)
    }
  }
  for (const parallel of [false, true]) {
    plan.push('+', 'test:agent', '--root', '../store', '--config', '/work/packages/store/vitest.config.ts', `--fileParallelism=${parallel}`)
  }
}
const result = spawnSync('pnpm', ['remote', '--machine', 'linux/amd64:4x8', '--env', 'JUNO_PLAN_SERIAL=1', '--env', 'JUNO_VITEST_WORKERS=4', 'test:plan', ...plan], {
  stdio: 'inherit', env: { ...process.env, JUNO_REMOTE_MAX_VCPU: '0' },
})
process.exitCode = result.status ?? 1
