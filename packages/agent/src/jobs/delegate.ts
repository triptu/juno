/**
 * The `delegate` tool (plan v3 §8, §9 Tier 2): starts a subagent job behind
 * a Task card. With no click it starts only in a clean owner run, one that
 * has not read Slack, a connection or a report (§6.4); otherwise the model
 * is told to ask, and the proposedTask card is WP15's. The job is keyed by
 * the tool call, so a replayed call finds the job it started.
 */
import { defineTool, type JunoTool, type ToolRun } from '../request/tool'
import type { Jobs } from './jobs'

export function delegateTool(options: {
  readonly jobs: Jobs
  readonly current: () => Promise<ToolRun | undefined>
  /** Where the card says it runs: the subagent's model name. */
  readonly place: string
}): JunoTool {
  return defineTool<{ readonly title: string; readonly task: string }>({
    name: 'delegate',
    description:
      'Start a background task on a helper model when the owner asks for work that can run on its own. ' +
      'The helper sees your memory and the task, has no tools, and reports back once. Only when the owner asked for it.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: "The task in the owner's words, short: shown on its card." },
        task: { type: 'string', description: 'Everything the helper needs to do the task.' },
      },
      required: ['title', 'task'],
      additionalProperties: false,
    },
    replay: 'safe',
    status: () => 'Starting a task',
    run: async ({ title, task }, call) => {
      const run = await options.current()
      if (run === undefined) return { text: 'No task was started.', isError: true }
      if (!run.clean) {
        return { text: 'No task was started: after reading Slack or a report, starting a task needs the owner to ask again.', isError: true }
      }
      const job = options.jobs.start({ kind: 'subagent', runId: run.runId, originOp: run.opId, callId: call.callId, title, place: options.place, task })
      return { text: `Started the task "${job.title}". Its result comes back as a report.` }
    },
  })
}
