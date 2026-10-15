// A card's click under the crash harness (plan v3 §6.3, §6.5, §16): the agent runs as a process
// (fixtures/actions.ts) and is killed at each action crash point. The restarted agent never sends the
// same click twice: a click not yet authorized runs once, an authorization consumed before handoff
// stays unknown and shows Failed, and a send the host made is found by reconcile and shows Sent.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { crashAt, runAgent } from '@juno/agent-testing'

const program = fileURLToPath(new URL('./fixtures/actions.ts', import.meta.url))
const hooks = fileURLToPath(new URL('../../../scripts/ts-resolve-hooks.mjs', import.meta.url))
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'juno-actions-crash-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const args = (...commands: string[]) => ['--no-warnings', '--import', hooks, program, dir, ...commands]

interface Summary {
  readonly cards: ReadonlyArray<unknown>
  readonly authorizations: ReadonlyArray<{ readonly outcome: string }>
  readonly attempts: number
  /** Send RPCs this process made. */
  readonly sends: number
  readonly slack: ReadonlyArray<string>
}

async function run(...commands: string[]): Promise<Summary> {
  const result = await runAgent({ args: args(...commands), timeoutMs: 60_000 })
  if (result.code !== 0) throw new Error(`agent exited with ${result.signal ?? result.code}\n${result.stderr}`)
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Summary
}

const propose = ['send:op-1:tell them I am on my way', 'idle']

it('a kill after the click commits: the restarted agent authorizes it once and sends', async () => {
  await crashAt('approval.committed', { args: args(...propose, 'click:click-1', 'idle'), timeoutMs: 60_000 })
  const after = await run('idle')
  expect(after.slack).toEqual(['On my way.'])
  expect(after.authorizations).toEqual([{ outcome: 'done' }])
  expect(after.cards).toEqual([{ _tag: 'done', line: 'Sent' }])
  // Another start sends nothing more.
  const again = await run('idle')
  expect(again.sends).toBe(0)
  expect(again.slack).toEqual(['On my way.'])
})

it('a kill after the authorization is consumed, before the handoff: unknown, Failed, and never sent', async () => {
  await crashAt('authorization.consumed', { args: args(...propose, 'click:click-1', 'idle'), timeoutMs: 60_000 })
  const after = await run('idle')
  expect(after.authorizations).toEqual([{ outcome: 'unknown' }])
  expect(after.attempts).toBe(0)
  expect(after.sends).toBe(0)
  expect(after.slack).toEqual([])
  expect(after.cards).toEqual([{ _tag: 'failed', line: 'Failed' }])
  // Another start changes nothing.
  const again = await run('idle')
  expect(again.sends).toBe(0)
  expect(again.authorizations).toEqual([{ outcome: 'unknown' }])
})

it('a kill after the host sent, before the receipt: unknown at startup, then reconcile finds it and the card says Sent', async () => {
  await crashAt('attempt.beforeReceipt', { args: args(...propose, 'click:click-1', 'idle'), timeoutMs: 60_000 })
  const after = await run('idle')
  expect(after.sends).toBe(0)
  expect(after.slack).toEqual(['On my way.'])
  expect(after.authorizations).toEqual([{ outcome: 'done' }])
  expect(after.attempts).toBe(1)
  expect(after.cards).toEqual([{ _tag: 'done', line: 'Sent' }])
})
