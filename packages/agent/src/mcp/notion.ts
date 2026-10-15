import { Schema } from 'effect'
import type { CallToolResult } from '@earendil-works/pi-mcp'
import type { McpManagerApi } from './manager'
import { McpError } from './types'

const Page = Schema.Struct({ id: Schema.String, content: Schema.String, last_edited_time: Schema.String })
const Update = Schema.Struct({ page_id: Schema.String, command: Schema.Literals(['replace_content', 'append_content']), content: Schema.String })
export const Preconditions = Schema.Struct({ pageId: Schema.String, edited: Schema.String, before: Schema.String, after: Schema.String })

function pageOf(result: CallToolResult) {
  if (result.isError) throw new McpError({ reason: 'unavailable', message: 'Notion could not read the page.' })
  const text = result.content.find((block) => block.type === 'text')
  if (!text || text.type !== 'text') throw new McpError({ reason: 'invalid', message: 'Notion returned no page version.' })
  return Schema.decodeUnknownSync(Page)(JSON.parse(text.text))
}

/** Fail closed when the hosted server cannot supply a version and an exact read-back shape. */
export async function notionPreconditions(manager: McpManagerApi, id: string, tool: string, args: unknown) {
  if (tool !== 'notion-update-page') return {}
  const update = Schema.decodeUnknownSync(Update)(args)
  const page = pageOf(await manager.invoke(id, 'notion-fetch', { id: update.page_id }))
  if (page.id !== update.page_id) throw new McpError({ reason: 'invalid', message: 'Notion returned another page.' })
  return { pageId: page.id, edited: page.last_edited_time, before: page.content,
    after: update.command === 'replace_content' ? update.content : `${page.content}\n${update.content}` }
}

export async function notionCheck(manager: McpManagerApi, id: string, preconditions: unknown): Promise<boolean> {
  const expected = Schema.decodeUnknownSync(Preconditions)(preconditions)
  const page = pageOf(await manager.invoke(id, 'notion-fetch', { id: expected.pageId }))
  return page.id === expected.pageId && page.last_edited_time === expected.edited && page.content === expected.before
}

export async function notionReconcile(manager: McpManagerApi, id: string, preconditions: unknown) {
  const expected = Schema.decodeUnknownSync(Preconditions)(preconditions)
  const page = pageOf(await manager.invoke(id, 'notion-fetch', { id: expected.pageId }))
  // A no-op, or a page with the original version, cannot prove this attempt landed.
  return page.id === expected.pageId && page.last_edited_time !== expected.edited && expected.before !== expected.after && page.content === expected.after
    ? { pageId: page.id, last_edited_time: page.last_edited_time } : undefined
}
