#!/usr/bin/env node
// Uploads the picture files build.mjs made to the R2 bucket `juno-art` and prints the
// bucket's public URL (scripts/pictures/README.md). Touches no other bucket or
// Cloudflare resource. Safe to run again: it creates the bucket and turns on its public
// r2.dev URL only when needed, and uploads only files the bucket lacks or that changed.
//
//   bunx wrangler login            (once, in a browser)
//   bun run pictures:upload [--out /Volumes/AgentWork/pictures-juno-art] [--dry-run]
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUCKET = 'juno-art'
const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).flatMap((arg, at, all) => (arg.startsWith('--') ? [[arg.slice(2), all[at + 1]?.startsWith('--') === false ? all[at + 1] : 'true']] : [])))
const out = args.out ?? (existsSync('/Volumes/AgentWork') ? '/Volumes/AgentWork/pictures-juno-art' : join(here, '.out'))
const dryRun = args['dry-run'] === 'true'

const wrangler = (...rest) => {
  if (dryRun) {
    console.log(['wrangler', ...rest].join(' '))
    return ''
  }
  return execFileSync('bun', ['x', 'wrangler@4', ...rest], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

const files = readdirSync(out).filter((name) => /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:small|large)\.webp$/.test(name)).sort()
if (files.length === 0) throw new Error(`No picture files in ${out}; run build.mjs first`)

if (!dryRun) {
  const who = wrangler('whoami')
  if (/not authenticated/i.test(who)) throw new Error('Run `bunx wrangler@4 login` first')
}

// The bucket, once.
const buckets = dryRun ? '' : wrangler('r2', 'bucket', 'list')
if (!new RegExp(`\\b${BUCKET}\\b`).test(buckets)) wrangler('r2', 'bucket', 'create', BUCKET)

// Public, read-only: the bucket's r2.dev URL serves GET only; writes need the account's credentials.
wrangler('r2', 'bucket', 'dev-url', 'enable', BUCKET, '--force')
const devUrl = dryRun ? 'https://pub-<id>.r2.dev' : /https:\/\/pub-[a-z0-9]+\.r2\.dev/.exec(wrangler('r2', 'bucket', 'dev-url', 'get', BUCKET))?.[0]

// What was uploaded before, by content hash, so a rerun sends only new or changed files.
const uploadedFile = join(out, 'uploaded.json')
const uploaded = existsSync(uploadedFile) ? JSON.parse(readFileSync(uploadedFile, 'utf8')) : {}
let sent = 0
for (const name of files) {
  const bytes = readFileSync(join(out, name))
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (uploaded[name] === hash) continue
  wrangler('r2', 'object', 'put', `${BUCKET}/${name}`, '--file', join(out, name), '--content-type', 'image/webp', '--cache-control', 'public, max-age=31536000, immutable', '--remote')
  uploaded[name] = hash
  sent++
  if (!dryRun) writeFileSync(uploadedFile, `${JSON.stringify(uploaded, null, 2)}\n`)
  process.stdout.write(`\r${sent} uploaded`)
}
console.log(`\n${files.length} files in ${BUCKET}, ${sent} sent now.`)
console.log(`Public URL: ${devUrl}/`)
console.log('Set PICTURES_URL in packages/engine/src/pictures/cache.ts to it.')
