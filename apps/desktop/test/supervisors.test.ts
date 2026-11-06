/**
 * Main's supervisors (`src/main/engine.ts`, `src/main/agent.ts`) around a
 * process that is stopped or given up on while its last events are still in
 * flight: a late `ready` or `exit` from the old process must not move the
 * supervisor, and the one it starts next must stay the only one. The forks
 * are fakes; the restart journeys with real processes are
 * e2e/juno-agent/crash.spec.ts.
 */
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'bun:test'
import type { MessagePortMain, UtilityProcess } from 'electron'
import type { MainToAgent } from '@juno/agent-contract'
import type { MainToEngine } from '@juno/contract'
import { AgentSupervisor } from '../src/main/agent'
import { EngineSupervisor } from '../src/main/engine'
import type { ProcessDeps } from '../src/main/processDeps'

/** A utility process as the supervisors see it: events in, messages out, and a kill. */
class FakeProcess extends EventEmitter {
  static next = 100
  readonly pid = FakeProcess.next++
  readonly sent: Array<unknown> = []
  killed = false
  postMessage(message: unknown): void {
    this.sent.push(message)
  }
  kill(): boolean {
    this.killed = true
    return true
  }
}

function fakeDeps() {
  const forked: FakeProcess[] = []
  const deps: ProcessDeps = {
    fork: () => {
      const child = new FakeProcess()
      forked.push(child)
      return child as unknown as UtilityProcess
    },
    channel: () => ({ port1: { close: () => {} } as unknown as MessagePortMain, port2: { close: () => {} } as unknown as MessagePortMain }),
  }
  return { forked, deps }
}

const engineConfig = { userData: join(tmpdir(), 'juno-supervisor-test'), e2e: true, dev: true }
const tags = (child: FakeProcess) => child.sent.map((message) => (message as MainToEngine | MainToAgent)._tag)

it('engine: a ready that arrives after the quit began leaves the supervisor stopped, and the exit starts nothing', async () => {
  const { forked, deps } = fakeDeps()
  const supervisor = new EngineSupervisor(engineConfig, () => {}, { ...deps, mark: () => {} })
  let readies = 0
  supervisor.onReady(() => { readies += 1 })
  supervisor.start()
  const engine = forked[0]!
  engine.emit('spawn')
  const stopping = supervisor.stop()
  expect(tags(engine)).toEqual(['config', 'quit'])
  // The engine finished starting while the quit was on its way.
  engine.emit('message', { _tag: 'ready' })
  expect(supervisor.currentState).toBe('stopped')
  expect(readies).toBe(0)
  engine.emit('exit', 0)
  await stopping
  expect(supervisor.currentState).toBe('stopped')
  expect(forked).toHaveLength(1)
})

it('engine: the old process exiting after give-up and restart leaves the new one running alone', () => {
  const { forked, deps } = fakeDeps()
  const supervisor = new EngineSupervisor(engineConfig, () => {}, { ...deps, mark: () => {} })
  supervisor.start()
  const first = forked[0]!
  first.emit('spawn')
  first.emit('message', { _tag: 'ready' })
  supervisor.giveUp()
  expect(first.killed).toBe(true)
  supervisor.restart()
  const second = forked[1]!
  expect(supervisor.pid).toBe(second.pid)
  // The killed process exits only now.
  first.emit('exit', 1)
  expect(supervisor.currentState).toBe('starting')
  expect(supervisor.pid).toBe(second.pid)
  second.emit('spawn')
  second.emit('message', { _tag: 'ready' })
  expect(supervisor.currentState).toBe('ready')
  expect(forked).toHaveLength(2)
})

const provider = { _tag: 'openRouter', key: 'k' } as const

function agentSupervisor(deps: ProcessDeps) {
  const hostPorts: MessagePortMain[] = []
  const supervisor = new AgentSupervisor(
    { agentDir: join(tmpdir(), 'juno-supervisor-test', 'agent'), e2e: true },
    (port) => hostPorts.push(port),
    () => true,
    async () => null,
    async () => null,
    deps,
  )
  return { supervisor, hostPorts }
}

it('agent: a provider set again before the stopped process exits links the new process once, when it spawns', () => {
  const { forked, deps } = fakeDeps()
  const { supervisor, hostPorts } = agentSupervisor(deps)
  supervisor.setProvider(provider)
  const first = forked[0]!
  first.emit('spawn')
  expect(hostPorts).toHaveLength(1)
  supervisor.setProvider(null)
  expect(first.killed).toBe(true)
  supervisor.setProvider(provider)
  const second = forked[1]!
  // The engine reports ready while the new agent has not spawned: nothing to link yet.
  supervisor.linkHost()
  expect(hostPorts).toHaveLength(1)
  expect(second.sent).toEqual([])
  second.emit('spawn')
  expect(tags(second)).toEqual(['config', 'provider', 'hostPort'])
  expect(hostPorts).toHaveLength(2)
  first.emit('exit', 0)
  expect(supervisor.currentState).toBe('starting')
  expect(supervisor.pid).toBe(second.pid)
})

it('agent: a ready in flight from a process just stopped does not make the supervisor ready', () => {
  const { forked, deps } = fakeDeps()
  const { supervisor } = agentSupervisor(deps)
  supervisor.setProvider(provider)
  const agent = forked[0]!
  agent.emit('spawn')
  supervisor.setProvider(null)
  agent.emit('message', { _tag: 'ready', host: { host: 'juno', protocol: 1 } })
  expect(supervisor.currentState).toBe('stopped')
  expect(supervisor.host).toBeUndefined()
  agent.emit('exit', 0)
  expect(supervisor.currentState).toBe('stopped')
  expect(forked).toHaveLength(1)
})
