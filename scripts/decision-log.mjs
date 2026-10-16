// Build the committed decision log, or check it without writing with --check.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const header = `# Decision log

A short, dated record of product and engineering decisions, newest first. Big structural decisions also get an ADR in \`docs/decisions/\`. Times are local (IST). A \`~\` means the time was reconstructed from nearby commits.

Format: \`- MM-DD HH:MM · who · decision. Why, if not obvious.\`

`

try {
  const directory = resolve(root, 'docs/decisions/log')
  const entries = readdirSync(directory).filter((name) => name.endsWith('.md')).map((name) => {
    const filename = /^(\d{4})-(\d{2}-\d{2})-(\d{2})(\d{2})-[a-z0-9-]+\.md$/.exec(name)
    const line = readFileSync(resolve(directory, name), 'utf8').trimEnd()
    const entry = /^- (\d{2}-\d{2}) ~?(\d{2}):(\d{2}) · [^\n]+ · [^\n]+$/.exec(line)
    if (!filename || !entry || filename[2] !== entry[1] || filename[3] !== entry[2] || filename[4] !== entry[3]) {
      throw new Error(`Invalid decision fragment: ${name}; use YYYY-MM-DD-HHMM-slug.md and one matching dated line`)
    }
    return { name, line, date: name.slice(0, 15) }
  }).toSorted((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
  const built = header + entries.map(({ line }) => line).join('\n') + '\n'
  const target = resolve(root, 'docs/decision-log.md')
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== built) throw new Error('Decision log is out of date; run node scripts/decision-log.mjs')
  } else writeFileSync(target, built)
  console.log(`Decision log: ${entries.length} entries${process.argv.includes('--check') ? ' checked' : ' built'}`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
