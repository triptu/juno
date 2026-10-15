import { Schema } from 'effect'
import { CardPayload } from '@juno/agent-cards'
import { memoryGen, type Proposal } from '../actions/cards'
import { uuidv7 } from '../store/store'
import { parseObject, validateArguments } from '../mcp/catalogue'
import { McpError } from '../mcp/types'
import type { McpManagerApi } from '../mcp/manager'

export const START = 't3_start'
export const LAUNCH = 't3_thread_launch'
export const Start = Schema.Struct({
  project: Schema.NonEmptyString, baseBranch: Schema.NonEmptyString, title: Schema.NonEmptyString,
  brief: Schema.NonEmptyString, planFirst: Schema.Boolean, replaces: Schema.optionalKey(Schema.String),
})
export type Start = typeof Start.Type

/** Check the discovered schema, not just a familiar tool name. */
export function launchArgs(manager: McpManagerApi, input: Start, actionId: string) {
  const definition = manager.tool('t3', LAUNCH).definition
  const schema = parseObject(parseObject(JSON.parse(definition)).inputSchema)
  const properties = parseObject(schema.properties)
  for (const key of ['projectId', 'title', 'message', 'runtimeMode', 'workspaceStrategy']) {
    if (!(key in properties)) throw new McpError({ reason: 'invalid', message: 'T3 Code has an unsupported launch schema. No session was started.' })
  }
  const base = {
    projectId: input.project, title: input.title,
    message: `${input.brief}\n\n[juno:${actionId}]`, runtimeMode: 'full-access',
    workspaceStrategy: { type: 'worktree', baseRef: input.baseBranch, startFromOrigin: false },
    ...('interactionMode' in properties ? { interactionMode: 'default' } : {}),
  }
  let args = base
  if (input.planFirst) {
    const planned = { ...base, interactionMode: 'plan' }
    try {
      if (!('interactionMode' in properties)) throw new Error('No plan mode')
      validateArguments(definition, planned)
      return planned
    } catch {
      args = { ...base, message: `${base.message}\n\nWrite a plan, then wait for approval before changing files.` }
    }
  }
  validateArguments(definition, args)
  return args
}

export async function startProposal(manager: McpManagerApi, input: Start, source: Pick<Proposal, 'runId' | 'callId'>): Promise<Proposal> {
  if (manager.state('t3') !== 'ready') throw new McpError({ reason: 'unavailable', message: 'Connect T3 Code before proposing a session.' })
  const actionId = uuidv7(manager.store.now())
  const args = launchArgs(manager, input, actionId)
  await manager.checkSecrets(args)
  const payload = Schema.decodeUnknownSync(CardPayload)({
    _tag: 'proposedTask', kind: 't3', title: input.title, where: `${input.project} · from ${input.baseBranch}`,
    because: input.brief + (input.planFirst ? '\n\nWrite a plan, then wait for approval before changing files.' : ''),
    action: {
      id: actionId, rev: 1, tier: 2, deduped: false, source: memoryGen(manager.store),
      payload: {
        connection_id: 't3', account_id: manager.stored('t3').epoch,
        destination_ids: [input.project], tool: START, schema_hash: manager.tool('t3', LAUNCH).hash,
        args, preconditions: {}, ops: [],
      },
    },
  })
  return { ...source, payload, ...(input.replaces === undefined ? {} : { replaces: input.replaces }) }
}
