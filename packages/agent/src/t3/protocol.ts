import { Schema } from 'effect'
import { McpError } from '../mcp/types'
import { parseObject } from '../mcp/catalogue'
import type { McpManagerApi } from '../mcp/manager'

/** MCP servers may return structured content or a JSON text block. */
export function content(result: Awaited<ReturnType<McpManagerApi['invoke']>>): unknown {
  if (result.isError) throw new McpError({ reason: 'unavailable', message: 'T3 Code did not confirm the result.' })
  if (result.structuredContent !== undefined) return result.structuredContent
  const text = result.content.find((item) => item.type === 'text')
  if (text?.type !== 'text') throw new McpError({ reason: 'invalid', message: 'T3 Code returned an unsupported response.' })
  return JSON.parse(text.text)
}

export const Session = Schema.Struct({ threadId: Schema.NonEmptyString, project: Schema.NonEmptyString, epoch: Schema.String })
export type Session = typeof Session.Type
export const sessionOf = (task: string) => Schema.decodeUnknownSync(Session)(JSON.parse(task))
export const launched = Schema.decodeUnknownSync(Schema.Struct({ threadId: Schema.NonEmptyString }))
export const threadState = Schema.decodeUnknownSync(Schema.Struct({ thread: Schema.Struct({ status: Schema.String, threadId: Schema.optionalKey(Schema.String), branch: Schema.optionalKey(Schema.NullOr(Schema.String)) }) }))

/** Never use the calling thread's worktree as the launched thread's branch. */
export async function sessionBranch(manager: McpManagerApi, threadId: string): Promise<string | undefined> {
  const tool = manager.tool('t3', 't3_worktree_status')
  const schema = parseObject(parseObject(JSON.parse(tool.definition)).inputSchema)
  const properties = parseObject(schema.properties ?? {})
  if (!('threadId' in properties)) return undefined
  const result = content(await manager.invoke('t3', 't3_worktree_status', { threadId }))
  const status = Schema.decodeUnknownSync(Schema.Struct({ threadId: Schema.String, branch: Schema.NullOr(Schema.String) }))(result)
  return status.threadId === threadId ? status.branch ?? undefined : undefined
}
