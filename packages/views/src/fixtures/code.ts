import { code, p, window } from './messages'
import { people } from './topics'

/**
 * One message with code blocks as people paste them: one tagged with its
 * language on the first line (the engine hands it over as `language`,
 * without that line), one whose language is detected, a stack trace that
 * stays plain, and a long tagged one that scrolls in its box.
 */
export const codeBlocks = window([
  {
    ago: 12,
    from: people.leo,
    blocks: [
      p('The retry wrapper, with the backoff capped:'),
      code(
        `export async function withRetry<A>(run: () => Promise<A>, tries = 3): Promise<A> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      // Give up after the last try.
      if (attempt >= tries) throw error
      await sleep(Math.min(250 * 2 ** attempt, 4_000))
    }
  }
}`,
        'typescript',
      ),
      p('The query that finds the stuck jobs:'),
      code(`SELECT id, kind, attempts
FROM jobs
WHERE state = 'running' AND started_at < now() - interval '15 minutes'
ORDER BY started_at
LIMIT 50;`),
      p('What the worker logged before it stopped:'),
      code(`TypeError: Cannot read properties of undefined (reading 'id')
    at handle (/srv/worker/jobs.js:88:31)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)`),
      p('And the whole migration script, for reference:'),
      code(
        `import sqlite3

def migrate(path: str) -> None:
    """Move every topic to the new table."""
    db = sqlite3.connect(path)
${Array.from({ length: 40 }, (_, index) => `    db.execute("UPDATE topics SET rev = rev + 1 WHERE shard = ?", (${index},))  # shard ${index + 1}`).join('\n')}
    db.commit()`,
        'python',
      ),
    ],
  },
])
