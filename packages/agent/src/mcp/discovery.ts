/**
 * What `find_tools` tells the model, one step at a time (docs/research/codemode.md, "Is this
 * progressive disclosure?"): the connected servers and their tool counts; then tools matching a
 * query, one line each; then one tool's argument schema, only when the model names it. Tools the
 * owner turned off never appear. Internal ids, schema hashes and addresses never reach the model:
 * a server is named by its handle (`McpManagerApi.handles`).
 */
import type { McpManagerApi } from './manager'
import { hintOf } from './manager'
import { parseObject } from './catalogue'
import { McpError } from './types'

/** At most this many tools for a query or a server's list; `more` says how many were left out. */
const LIMIT = 20
const ABOUT_LIMIT = 1000

/** The connection behind a handle the model used, or an internal id a test or an older turn used. */
export function resolveServer(manager: McpManagerApi, name: string): string {
  const id = manager.handles().get(name) ?? (manager.configs().some((config) => config.id === name) ? name : undefined)
  if (id === undefined) throw new McpError({ reason: 'unavailable', message: 'There is no connection by that name.' })
  return id
}

const handleOf = (manager: McpManagerApi, id: string) => [...manager.handles()].find(([, value]) => value === id)?.[0] ?? id

/** No arguments: the servers that are on, their state and how many tools each offers, and the names of those that are off. */
export function serverIndex(manager: McpManagerApi) {
  const servers = manager.configs().filter((config) => config.enabled).map((config) => ({
    server: handleOf(manager, config.id), name: config.label, state: manager.state(config.id),
    ...(manager.state(config.id) === 'ready' ? { tools: manager.definitions(config.id).length } : {}),
  }))
  const off = manager.configs().filter((config) => !config.enabled).map((config) => handleOf(manager, config.id))
  return { servers, ...(off.length > 0 ? { off } : {}) }
}

const line = (manager: McpManagerApi, id: string) => (tool: ReturnType<McpManagerApi['definitions']>[number]) => {
  const { hint } = hintOf(JSON.stringify(tool.definition))
  return { server: handleOf(manager, id), tool: tool.name, ...(hint === undefined ? {} : { about: hint }), ...(tool.tier === 0 ? { read: true } : {}) }
}

/**
 * Tools whose name or one-line description holds every word of `query`, across the ready servers
 * or only `server`. With no query, every tool of `server`. One line each, never a schema.
 */
export function findTools(manager: McpManagerApi, input: { readonly server?: string; readonly query?: string }) {
  const ids = input.server !== undefined ? [resolveServer(manager, input.server)] : manager.configs().filter((config) => manager.state(config.id) === 'ready').map((config) => config.id)
  const words = (input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const found = ids.flatMap((id) => manager.definitions(id).map(line(manager, id)))
    .filter((tool) => words.every((word) => `${tool.tool.replace(/[-_.]/g, ' ')} ${tool.tool} ${tool.about ?? ''}`.toLowerCase().includes(word)))
  return { tools: found.slice(0, LIMIT), ...(found.length > LIMIT ? { more: found.length - LIMIT } : {}) }
}

/** One tool's description and argument schema, for the call the model is about to make. */
export function toolSchema(manager: McpManagerApi, server: string, name: string) {
  const id = resolveServer(manager, server)
  const tool = manager.tool(id, name)
  const definition = parseObject(JSON.parse(tool.definition))
  const about = typeof definition.description === 'string' ? definition.description.trim().slice(0, ABOUT_LIMIT) : undefined
  return {
    server: handleOf(manager, id), tool: name, ...(about ? { about } : {}), ...(tool.tier === 0 ? { read: true } : {}),
    inputSchema: definition.inputSchema ?? { type: 'object' },
  }
}
