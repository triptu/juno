/**
 * The `delegate` tool (plan v3 §8, §9 Tier 2): starts a subagent job behind
 * a Task card. With no click it starts only in a clean owner run, one that
 * has not read Slack, a connection or a report (§6.4), and the start mints
 * the job's grant. Otherwise it proposes a Proposed task card, whose Start
 * click starts the job (`actions/proposals.ts`). The job and the card are
 * keyed by the tool call, so a replayed call finds what it started.
 */
import { toolDecision } from '../policy/policy'
import { defineTool, type JunoTool, type ToolRun } from '../request/tool'
import type { Job, Jobs } from './jobs'

export interface DelegateActions {
  /** Proposes the Proposed task card. Returns its card id. */
  readonly propose: (run: ToolRun, callId: string, task: { readonly title: string; readonly task: string }) => string
  /** Mints the job's grant under the clean run's authority. */
  readonly granted: (job: Job, run: ToolRun) => void
}

export function delegateTool(options: {
  readonly jobs: Jobs
  readonly current: () => Promise<ToolRun | undefined>
  /** Where the card says it runs: the subagent's model name. */
  readonly place: string
  readonly actions?: DelegateActions
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
      if (toolDecision('delegateSpawn', run)._tag !== 'run') {
        if (options.actions === undefined) {
          return { text: 'No task was started: after reading Slack or a report, starting a task needs the owner to ask again.', isError: true }
        }
        const card = options.actions.propose(run, call.callId, { title, task })
        return { text: `Proposed card ${card}: the task "${title}" starts when the owner clicks Start.` }
      }
      const job = options.jobs.start({ kind: 'subagent', runId: run.runId, originOp: run.opId, callId: call.callId, title, place: options.place, task })
      options.actions?.granted(job, run)
      return { text: `Started the task "${job.title}". Its result comes back as a report.` }
    },
  })
}
