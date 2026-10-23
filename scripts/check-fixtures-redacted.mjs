#!/usr/bin/env bun
/**
 * Checks that the shapes recorded by the live smoke
 * (packages/slack-schema/test/fixtures/recorded/) hold no real data: no
 * Slack ids other than the redacted placeholders, no tokens, no emails, no
 * URLs other than https://redacted.invalid/, no timestamps other than the
 * placeholder, and no free text (every string must be one of the kept
 * enum-like values, a placeholder, or empty). Run by `bun run lint`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'packages/slack-schema/test/fixtures/recorded')

/** Keys whose string values the smoke keeps as they are: short enum-like words from Slack, never user data. */
const KEEP_KEYS = new Set(['ok', 'type', 'subtype', 'error', 'kind', 'presence', 'mode', 'variant', 'reason', 'priority', 'style'])
const PLACEHOLDERS = new Set(['redacted', 'xoxc-redacted', 'https://redacted.invalid/', 'wss://redacted.invalid/', '1700000000.000001', ''])
const ID_PLACEHOLDER = /^[A-Z]0REDACTED$/
const SLACK_ID = /\b[A-Z][A-Z0-9]{8,}\b/
const TOKEN = /xox[a-z]-[A-Za-z0-9-]{8,}/
const EMAIL = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i
const URL = /(https?|wss?):\/\/(?!redacted\.invalid\/)/
const TS = /^\d{10}\.\d{6}$/
const ENUM_WORD = /^[a-z0-9_]{1,40}$/

const problems = []

function check(value, path, key) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => check(item, `${path}[${index}]`, key))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SLACK_ID.test(k) && !ID_PLACEHOLDER.test(k)) problems.push(`${path}: key looks like a real id`)
      check(v, `${path}.${k}`, k)
    }
    return
  }
  if (typeof value !== 'string') return
  if (PLACEHOLDERS.has(value) || ID_PLACEHOLDER.test(value)) return
  if (TOKEN.test(value)) problems.push(`${path}: token`)
  else if (EMAIL.test(value)) problems.push(`${path}: email`)
  else if (URL.test(value)) problems.push(`${path}: url`)
  else if (TS.test(value)) problems.push(`${path}: real timestamp`)
  else if (SLACK_ID.test(value)) problems.push(`${path}: id`)
  else if (key !== undefined && KEEP_KEYS.has(key) && ENUM_WORD.test(value)) return
  else problems.push(`${path}: free text`)
}

function* files(at) {
  for (const name of readdirSync(at)) {
    const full = join(at, name)
    if (statSync(full).isDirectory()) yield* files(full)
    else if (name.endsWith('.json')) yield full
  }
}

let count = 0
for (const file of files(dir)) {
  count++
  const before = problems.length
  check(JSON.parse(readFileSync(file, 'utf8')), '$')
  for (const problem of problems.slice(before)) console.error(`${relative(root, file)} ${problem}`)
}

if (problems.length > 0) {
  console.error(`check-fixtures-redacted: ${problems.length} problem(s) in ${count} file(s)`)
  process.exit(1)
}
console.log(`check-fixtures-redacted: ${count} file(s) ok`)
