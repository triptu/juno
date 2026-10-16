/**
 * Codemode scripts for reads (docs/research/codemode.md). `runtime/codemode.ts`
 * scopes pi's code mode tool; this folder decides what a script may call and
 * keeps Juno's record of what it did.
 */
import { CONNECTION_READ } from '../mcp/tools'
import type { JunoTool } from '../request/tool'
import { createScripts, SCRIPT_TOOL, type CodemodeRunner, type Scripts } from '../runtime/codemode'
import type { Store } from '../store/store'
import { scriptAudit } from './audit'

export { activityScripts } from './audit'
export { SCRIPT_MIGRATIONS } from './schema'
export type { CodemodeRunner } from '../runtime/codemode'

/**
 * Everything a script may call: the host's Slack reads, and connection tools
 * Juno reviewed as reads. An explicit list, so a new tool is never callable
 * from a script until it is added here. It has no writes, no proposals, no
 * memory or schedule changes, no jobs, no T3 starts and no Codex harness, and
 * not the code mode tool itself, so a script cannot start a script.
 */
const SCRIPT_READS: ReadonlySet<string> = new Set([
  'slack_search', 'slack_history', 'slack_replies', 'slack_topics', 'slack_person', 'slack_channels', CONNECTION_READ,
])

export function openScripts(store: Store, runner: CodemodeRunner, runId: () => string | undefined): { readonly scripts: Scripts; readonly tool: JunoTool & { readonly taints: true } } {
  const scripts = createScripts({ runner, reads: () => SCRIPT_READS, audit: scriptAudit(store, runId) })
  // A script reads untrusted content: the run is tainted before it runs.
  return { scripts, tool: { name: SCRIPT_TOOL, registration: scripts.registration, status: () => 'Running a script', taints: true } }
}
