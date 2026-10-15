import { Schema } from 'effect'
import type { ExecutorCall } from '../actions'
import type { McpManagerApi } from '../mcp/manager'
import { content } from './protocol'

/** Search is only a candidate list. The recorded first message must contain our exact tag. */
export async function reconcileStart(manager: McpManagerApi, call: ExecutorCall) {
  if (manager.stored('t3').epoch !== call.payload.account_id) return { _tag: 'unknown' } as const
  try {
    if (manager.state('t3') !== 'ready' && manager.stored('t3').config.enabled) await manager.connect('t3')
    const tag = `[juno:${call.actionId}]`
    const result = Schema.decodeUnknownSync(Schema.Struct({ matches: Schema.Array(Schema.Struct({ threadId: Schema.String })) }))(
      content(await manager.invoke('t3', 't3_thread_search', { query: tag })),
    )
    for (const match of result.matches) {
      const read = Schema.decodeUnknownSync(Schema.Struct({
        thread: Schema.Struct({ threadId: Schema.String, projectId: Schema.String }),
        items: Schema.Array(Schema.Struct({ text: Schema.NullOr(Schema.String) })),
      }))(content(await manager.invoke('t3', 't3_thread_read', { threadId: match.threadId })))
      const args = Schema.decodeUnknownSync(Schema.Struct({ projectId: Schema.String, message: Schema.String }))(call.payload.args)
      if (manager.stored('t3').epoch === call.payload.account_id && read.thread.threadId === match.threadId && read.thread.projectId === args.projectId && read.items.some((item) => item.text === args.message) && args.message.includes(tag)) {
        return { _tag: 'found', receipt: { threadId: match.threadId } } as const
      }
    }
  } catch { /* No positive evidence: keep the original unknown outcome. */ }
  return { _tag: 'unknown' } as const
}
