import { Effect } from 'effect'
import { AgentCommandError, ScheduleId, type OpId } from '@juno/agent-contract'
import { authorityOf } from '../grants/grants'
import { mayAuthorize } from '../policy/policy'
import { scheduleCard, type ScheduleCards } from './cards'
import type { NotificationHours } from './rules'

/** Host must verify this is the owner's message, and supply saved notification hours. */
export interface WatchHost {
  readonly ownMessage: (input: { readonly channelId: string; readonly ts: string; readonly threadTs?: string }) => Promise<boolean>
  readonly hours: () => Promise<NotificationHours>
}
export function watchReplyCommand(context: ScheduleCards, host: WatchHost, input: {
  readonly opId: OpId; readonly channelId: string; readonly ts: string; readonly threadTs?: string
}) {
  return Effect.tryPromise({
    try: async () => {
      if (!mayAuthorize(authorityOf(context.store))) throw new AgentCommandError({ reason: 'readOnly', message: 'Juno cannot set a watch now.' })
      if (!await host.ownMessage(input)) throw new AgentCommandError({ reason: 'invalid', message: 'Choose one of your own messages.' })
      const hours = await host.hours()
      const row = context.scheduler.watchReply({ opId: input.opId, watch: input, hours })
      if (row === undefined) throw new AgentCommandError({ reason: 'readOnly', message: 'Juno cannot set a watch now.' })
      context.propose({ runId: `schedule:${row.id}`, callId: `schedule-card:${row.id}`, payload: scheduleCard(context.store, row) })
      return { opId: input.opId, id: ScheduleId.make(row.id), at: row.dueAt }
    },
    catch: (error) => error instanceof AgentCommandError ? error : new AgentCommandError({ reason: 'unavailable', message: 'The conversation could not be checked.' }),
  })
}
