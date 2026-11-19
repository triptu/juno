import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { scratchFolder } from './worktree-folder.mjs'

/** Each tool gets its own home, temporary files, Git config and heavy queue, which ignores the machine's load. */
export function toolFixture(t) {
  mkdirSync(scratchFolder(), { recursive: true })
  const root = mkdtempSync(join(scratchFolder(), 'juno-tool-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const folder of ['home', 'tmp']) mkdirSync(join(root, folder))
  const env = { ...process.env, HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'), TMP: join(root, 'tmp'), TEMP: join(root, 'tmp'),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', JUNO_HEAVY_IGNORE_LOAD: '1',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  // A full run sets the JUNO_ plan and budget keys for its own steps; the tools under test must not inherit them.
  for (const key of ['JEST_WORKER_ID', 'JUNO_HEAVY_HELD', 'JUNO_HEAVY_QUEUE', 'JUNO_RUNNER_PARENT', 'JUNO_SKIP_TAGS', 'JUNO_VERIFY_POLICY', 'JUNO_MEMORY_BUDGET', 'JUNO_PLAN_SERIAL', 'JUNO_PLAN_OVERLAP', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key]
  const write = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim()
  return { root, env, write, git }
}
