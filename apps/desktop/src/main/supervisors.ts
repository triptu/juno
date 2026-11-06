/**
 * Forks the engine and the agent as Electron utility processes, each with the
 * config its environment gives it, and supervises them (`engine.ts`,
 * `agent.ts`). Electron comes in only here, so the supervisors run under
 * bun test with fakes.
 */
import { app, MessageChannelMain, utilityProcess, type MessagePortMain } from 'electron'
import { join } from 'node:path'
import type { CredentialRequest, SecretRequest } from '@juno/agent-contract'
import type { EngineToMain } from '@juno/contract'
import { AgentSupervisor } from './agent'
import { EngineSupervisor } from './engine'
import type { ProcessDeps } from './processDeps'
import { startupMark } from './startupMarks'

const processDeps: ProcessDeps = {
  fork: (script, options) => utilityProcess.fork(join(__dirname, script), [], { ...options, stdio: 'inherit' }),
  channel: () => new MessageChannelMain(),
}

export function createSupervisor(options: { readonly fakeSlackUrl?: string; readonly onMessage?: (message: EngineToMain) => void } = {}): EngineSupervisor {
  const e2e = process.env.JUNO_E2E === '1'
  // ProviderStore sends the shared key after loading and on every change.
  const ai = e2e || process.env.JUNO_AI === 'fake' ? 'fake' : 'live'
  // An e2e run can make the fake AI slow, to watch a check give up at its timeout.
  const fakeAiDelayMillis = e2e ? Number(process.env.JUNO_FAKE_AI_DELAY_MS) : Number.NaN
  // An e2e run can play the next build, which adds a cache migration.
  const cacheMigrationProbe = e2e && process.env.JUNO_E2E_CACHE_MIGRATION === '1'
  // An e2e run can keep production request pacing against the fake, to time a first sync.
  const fakeSlackPaced = e2e && process.env.JUNO_E2E_FAKE_PACED === '1'
  // An e2e run keeps the background AI jobs off unless the test opts in.
  const aiJobs = !e2e || process.env.JUNO_E2E_AI_JOBS === '1'
  return new EngineSupervisor(
    {
      userData: app.getPath('userData'),
      e2e,
      dev: !app.isPackaged,
      ...(options.fakeSlackUrl === undefined ? {} : { fakeSlackUrl: options.fakeSlackUrl }),
      ...(fakeSlackPaced ? { fakeSlackPaced } : {}),
      ai,
      ...(aiJobs ? {} : { aiJobs }),
      ...(e2e && process.env.JUNO_FAKE_AI_REQUIRES_KEY === '1' ? { fakeAiRequiresKey: true } : {}),
      ...(Number.isFinite(fakeAiDelayMillis) ? { fakeAiDelayMillis } : {}),
      ...(cacheMigrationProbe ? { cacheMigrationProbe } : {}),
    },
    options.onMessage ?? (() => {}),
    { ...processDeps, mark: startupMark },
  )
}

export function createAgentSupervisor(
  sendToEngine: (port: MessagePortMain) => void,
  engineReady: () => boolean,
  credential: (request: CredentialRequest) => Promise<string | null | undefined>,
  secret: (request: SecretRequest) => Promise<string | null | undefined>,
): AgentSupervisor {
  const e2e = process.env.JUNO_E2E === '1'
  // Read only under JUNO_E2E, so a real run can never be pointed elsewhere.
  const openRouterOrigin = e2e ? process.env.JUNO_FAKE_OPENROUTER_URL : undefined
  // Two test apps play two Macs: each has a name, and the backup exports often enough to see the other.
  const deviceName = e2e ? process.env.JUNO_E2E_DEVICE_NAME : undefined
  const interval = e2e ? Number(process.env.JUNO_E2E_BACKUP_INTERVAL_MS) : Number.NaN
  // The `agent.codemode` flag, off unless set.
  const codemode = process.env.JUNO_AGENT_CODEMODE === '1'
  // Background updates of person files call the model, so a test opts in.
  const peopleRefresh = !e2e || process.env.JUNO_E2E_PEOPLE_REFRESH === '1'
  return new AgentSupervisor(
    {
      agentDir: join(app.getPath('userData'), 'agent'),
      e2e,
      ...(openRouterOrigin === undefined ? {} : { openRouterOrigin }),
      ...(deviceName === undefined ? {} : { deviceName }),
      ...(Number.isFinite(interval) && interval > 0 ? { backupIntervalMs: interval } : {}),
      ...(codemode ? { codemode } : {}),
      peopleRefresh,
    },
    sendToEngine,
    engineReady,
    credential,
    secret,
    processDeps,
  )
}
