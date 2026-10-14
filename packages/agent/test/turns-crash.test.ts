// A turn under the crash harness (plan v3 §3, §16): the engine runs as a process
// (fixtures/turns.ts), is killed mid-turn, and the restarted process finishes the same run.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { runAgent } from '@juno/agent-testing'

const program = fileURLToPath(new URL('./fixtures/turns.ts', import.meta.url))
const hooks = fileURLToPath(new URL('../../../scripts/ts-resolve-hooks.mjs', import.meta.url))
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'juno-turns-crash-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const args = (...commands: string[]) => ['--no-warnings', '--import', hooks, program, dir, ...commands]

async function run(...commands: string[]) {
  const result = await runAgent({ args: args(...commands), timeoutMs: 60_000 })
  if (result.code !== 0) throw new Error(`agent exited with ${result.signal ?? result.code}\n${result.stderr}`)
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as {
    opened: string
    ops: Record<string, string>
    messages: ReadonlyArray<[string, string]>
    endings: ReadonlyArray<unknown>
    searches: number
    chatRequests: number
  }
}

it('a kill mid-turn, after a tool round, resumes the same run without repeating the input or the tool call', async () => {
  // The model searched Slack; the process dies while the answer is being requested.
  const killed = await runAgent({ args: args('killInAnswer', 'send:op-1:find lunch', 'idle'), timeoutMs: 60_000 })
  expect(killed.crashed).toBe(true)

  // The renderer may send the same op again; the inbox holds it once.
  const after = await run('send:op-1:find lunch', 'idle')
  expect(after.opened).toBe('resumed')
  expect(after.ops).toEqual({ 'op-1': 'done' })
  expect(after.endings).toEqual([{ _tag: 'complete' }])
  // Only the interrupted request is sent again; the search is not run again.
  expect(after.searches).toBe(0)
  expect(after.chatRequests).toBe(1)
  expect(after.messages.map(([kind]) => kind)).toEqual(['user', 'juno', 'tool', 'juno'])
  expect(after.messages[0]).toEqual(['user', '<message id="n1">find lunch</message>'])
  expect(after.messages.at(-1)).toEqual(['juno', 'Found it.'])
})
