import type { RichTextElement } from '@juno/slack-schema'
import { SELF_ID, TEAM } from '../fixtures.ts'
import { NEVER_READ, type Workspace } from '../state.ts'

export const CODE_BLOCKS_CHANNEL = 'C0PERFCODE'

/** How many messages, each with one code block, the seed posts. */
export const CODE_BLOCK_COUNT = 50

const LEO = 'U0PERFLEO'

/** A TypeScript block of `lines` lines, distinct for each `n`. */
function typescript(n: number, lines: number): string {
  const out = [`export interface Job${n} {`, '  readonly id: string', '  readonly attempts: number', '}', '', `export async function run${n}(jobs: ReadonlyArray<Job${n}>, limit = ${n + 3}): Promise<number> {`]
  for (let i = 0; out.length < lines - 2; i++) out.push(`  const step${i} = jobs.filter((job) => job.attempts > ${i} && job.id !== 'job-${n}-${i}').length // step ${i}`)
  return [...out, `  return limit * ${n}`, '}'].join('\n')
}

function python(n: number, lines: number): string {
  const out = ['import json', '', `def migrate_${n}(rows, limit=${n + 5}):`, `    """Move batch ${n} to the new table."""`, '    done = []']
  for (let i = 0; out.length < lines - 1; i++) out.push(`    if rows[${i}]["id"] != "row-${n}-${i}": done.append(json.dumps({"step": ${i}, "ok": True}))`)
  return [...out, '    return done'].join('\n')
}

function sql(n: number, lines: number): string {
  const out = [`SELECT j.id, j.kind, count(a.id) AS attempts_${n}`, 'FROM jobs j', 'LEFT JOIN attempts a ON a.job_id = j.id']
  for (let i = 0; out.length < lines - 3; i++) out.push(`  ${i === 0 ? 'WHERE' : 'AND'} j.state <> 'state-${n}-${i}' -- filter ${i}`)
  return [...out, 'GROUP BY j.id', 'ORDER BY attempts DESC', `LIMIT ${n + 10};`].join('\n')
}

function go(n: number, lines: number): string {
  const out = ['package main', '', 'import "fmt"', '', `func handle${n}(ids []string) error {`]
  for (let i = 0; out.length < lines - 2; i++) out.push(`\tif err := check("id-${n}-${i}", ids); err != nil { return fmt.Errorf("step ${i}: %w", err) }`)
  return [...out, '\treturn nil', '}'].join('\n')
}

function yaml(n: number, lines: number): string {
  const out = ['apiVersion: apps/v1', 'kind: Deployment', 'metadata:', `  name: worker-${n}`, 'spec:', `  replicas: ${(n % 5) + 1}`, '  template:', '    spec:', '      containers:']
  for (let i = 0; out.length < lines; i++) out.push(`        - name: sidecar-${n}-${i}`, `          image: ghcr.io/acme/sidecar:${i}.${n}`)
  return out.slice(0, lines).join('\n')
}

const KINDS = [
  { tag: 'ts', write: typescript },
  { tag: 'python', write: python },
  { tag: 'sql', write: sql },
  { tag: 'go', write: go },
  { tag: 'yaml', write: yaml },
] as const

/**
 * A channel, `#perf-code`, with 50 messages that each carry one distinct
 * code block of 40 to 100 lines in five languages; every other block is
 * tagged on its first line, the rest are detected. It measures a topic
 * that is mostly code, opened again once its colours are known.
 */
export function codeBlocksSeed(): (workspace: Workspace, avatarBase: string) => { readonly codeId: string } {
  return (workspace, avatarBase) => {
    const now = workspace.clock.now()
    if (workspace.users.get(LEO) === undefined) {
      workspace.addUser({ id: LEO, team_id: TEAM.id, name: 'Leo Park', real_name: 'Leo Park', profile: { display_name: 'Leo Park', avatar_hash: 'fakeu0perfleo', image_72: `${avatarBase}/${LEO}.svg` } })
    }
    workspace.addConversation({ id: CODE_BLOCKS_CHANNEL, name: 'perf-code', kind: 'public', members: new Set([SELF_ID, LEO]), created: now, topic: '', purpose: '', isOpen: true, archived: false })
    for (let n = 0; n < CODE_BLOCK_COUNT; n++) {
      const kind = KINDS[n % KINDS.length]!
      const body = kind.write(n, 40 + ((n * 13) % 61))
      const code = n % 2 === 0 ? `${kind.tag}\n${body}` : body
      const text = `Code sample ${n + 1}, for review.`
      workspace.post({
        channel: CODE_BLOCKS_CHANNEL,
        user: n % 3 === 0 ? SELF_ID : LEO,
        text,
        blocks: [{ type: 'rich_text', elements: [
          { type: 'rich_text_section', elements: [{ type: 'text', text }] },
          { type: 'rich_text_preformatted', elements: [{ type: 'text', text: code }] } satisfies RichTextElement,
        ] }],
        at: now - (CODE_BLOCK_COUNT - n) * 60_000,
        silent: true,
      })
    }
    workspace.reads.set(CODE_BLOCKS_CHANNEL, NEVER_READ)
    return { codeId: `m:${CODE_BLOCKS_CHANNEL}` }
  }
}
