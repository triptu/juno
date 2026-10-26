#!/usr/bin/env bun
// Fails the lint step when a test file gains a pattern that makes tests pass or fail by timing
// (docs/development.md, "Rules for tests"):
//
// - sleep: a fixed wait (`waitForTimeout`, `Bun.sleep`, a promise around `setTimeout`). Wait for the thing the test
//   asserts. A wait that shows nothing happens, with no signal that marks the end, says so: `// Fixed wait: <why>`.
// - read-once: an assertion on a value read once from something async writes (a locator's text, attribute or count,
//   the fake's calls). Use the retrying matcher (`toHaveText`, `toHaveAttribute`, `toHaveCount`) or `expect.poll`.
//   A value the awaited step already settled says so: `// Settled: <why>`.
// - time-of-day: reading the hour, minute or weekday of the real clock. Set the time (a test clock) or the hours
//   around it. A helper that does that says so: `// Time of day: <why>`.
// - wall-time: an assertion on elapsed wall time. Budgets belong to perf; count work instead. `// Wall time: <why>`.
//
// The marker goes on the line or one of the three above it. Files that had hits when this check came in keep their
// count in scripts/test-patterns-baseline.json, and the check fails when a file's count for a rule grows.
// `bun scripts/check-test-patterns.mjs --update` writes the current counts; lower them as sites are fixed.
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselineFile = path.join(root, 'scripts/test-patterns-baseline.json')

const rules = [
  {
    name: 'sleep',
    marker: 'Fixed wait:',
    pattern: /\bwaitForTimeout\(|\bBun\.sleep\(|setTimeout\(\s*(?:r|res|resolve|done|wake)\s*[,)]|setTimeout\(\s*\(\)\s*=>\s*(?:r|res|resolve|done|wake)\(\)/,
    advice: 'wait for the condition the test asserts',
  },
  {
    name: 'read-once',
    marker: 'Settled:',
    pattern: /expect\(\s*await\s[^;]*\.(?:textContent|innerText|innerHTML|getAttribute|inputValue|isVisible|isHidden|isChecked|isEnabled|isDisabled|count)\(|expect\((?![^;]*\bpoll\b)[^;]*\.(?:calls|received)\b/,
    advice: 'use a retrying matcher or expect.poll',
  },
  {
    name: 'time-of-day',
    marker: 'Time of day:',
    pattern: /\.(?:getHours|getMinutes|getDay|getUTCHours|getUTCMinutes|getUTCDay)\(\)/,
    advice: 'set the time with a test clock, or the hours around now',
  },
  {
    name: 'wall-time',
    marker: 'Wall time:',
    pattern: /expect\([^;]*(?:performance\.now\(\)|Date\.now\(\))/,
    advice: 'count work instead; time budgets belong to perf',
  },
]

/** Test files and the helpers only tests use. Perf files measure time on purpose. */
function testFiles() {
  const patterns = [
    'apps/desktop/e2e/**/*.ts',
    'apps/desktop/dom/**/*.ts',
    'apps/desktop/test/**/*.ts',
    'apps/gallery/*.ts',
    'packages/*/test/**/*.{ts,tsx}',
    'packages/testing/src/**/*.ts',
  ]
  return patterns
    .flatMap((pattern) => globSync(pattern, { cwd: root }))
    .filter((file) => !/(^|\/)(node_modules|dist|test-results)\//.test(file) && !/perf/i.test(path.basename(file)) && !file.includes('/perf/'))
    .toSorted()
}

/** Each rule's hits in one file's text: line numbers without the rule's marker nearby. */
function hitsIn(text) {
  const lines = text.split('\n')
  const hits = []
  lines.forEach((line, index) => {
    const code = line.replace(/\/\/.*$/, '')
    for (const rule of rules) {
      if (!rule.pattern.test(code)) continue
      const near = lines.slice(Math.max(0, index - 3), index + 1).join('\n')
      if (!near.includes(rule.marker)) hits.push({ rule: rule.name, line: index + 1, text: line.trim() })
    }
  })
  return hits
}

if (import.meta.main) {
  const counts = {}
  const found = new Map()
  for (const file of testFiles()) {
    const hits = hitsIn(readFileSync(path.join(root, file), 'utf8'))
    if (hits.length === 0) continue
    found.set(file, hits)
    counts[file] = {}
    for (const hit of hits) counts[file][hit.rule] = (counts[file][hit.rule] ?? 0) + 1
  }
  if (process.argv.includes('--update')) {
    writeFileSync(baselineFile, `${JSON.stringify(counts, null, 2)}\n`)
    console.log(`check-test-patterns: baseline written for ${Object.keys(counts).length} files`)
    process.exit(0)
  }
  const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : {}
  const failures = []
  for (const [file, hits] of found) {
    for (const rule of rules) {
      const now = counts[file][rule.name] ?? 0
      const before = baseline[file]?.[rule.name] ?? 0
      if (now <= before) continue
      failures.push(`${file}: ${rule.name} ${before} → ${now}: ${rule.advice}, or mark a deliberate one with \`// ${rule.marker} <why>\``)
      for (const hit of hits.filter((entry) => entry.rule === rule.name)) failures.push(`    ${file}:${hit.line}: ${hit.text}`)
    }
  }
  if (failures.length > 0) {
    console.error('Test timing patterns grew (docs/development.md, "Rules for tests"):')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exit(1)
  }
  const total = Object.values(counts).reduce((sum, file) => sum + Object.values(file).reduce((a, b) => a + b, 0), 0)
  console.log(`check-test-patterns: ok (${total} known sites in ${Object.keys(counts).length} files)`)
}
