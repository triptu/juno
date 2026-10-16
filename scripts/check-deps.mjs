#!/usr/bin/env node
// Checks the Juno package graph (docs/architecture.md sections 3 and 15).
//
// Edges come from each package.json:
//   "juno": { "allowedDeps": ["@juno/x"], "exceptions": ["@juno/y"], "testDeps": ["@juno/z"] }
// testDeps are devDependencies used only by tests (for example a client used to test a server).
// allowedDeps is the architecture graph for that package. exceptions lists
// current @juno dependencies that are outside the graph. They are reported as
// warnings on every run, and must still be declared, so the list cannot rot.
//
// Fails on: a missing allowedDeps field, a declared @juno dependency outside
// the allowed list, an unknown @juno package, a dependency cycle, an import of
// an undeclared @juno package in src, test or e2e, and the hard rules below
// (package rules, the Juno Agent bans, directory rules, the unstable Effect
// module allow-list, the pi and Codex import sites, engine feature folders and
// the sendSync ban).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const warnings = []

// Packages whose src may import only effect's Schema (exactly that named import
// from the root 'effect' module, as used today by domain/ids.ts).
const schemaOnlyEffect = new Set(['@juno/domain', '@juno/richtext', '@juno/agent-memory', '@juno/agent-cards'])
// Packages whose src must not import effect at all.
// (@juno/views is covered by the `views` directory rule below.)
const noEffect = new Set(['@juno/ui', '@juno/tokens', '@juno/domain', '@juno/richtext', '@juno/agent-memory', '@juno/agent-cards'])
// Packages whose src must not import @juno/state.
const noState = new Set(['@juno/ui', '@juno/notifications'])
// The only package allowed to import electron.
const electronOwner = '@juno/desktop'

// Juno Agent (docs/juno-agent/plan-v3.md section 2.1, ADR 0012). The agent is portable: no
// agent package reaches Electron or Slack, and the core does not reach Juno's store, sync or
// engine either. Checked against declared dependencies and against every import, so adding a
// package to allowedDeps does not get around it.
const agentSlackBan = ['electron', '@juno/slack', '@juno/slack-schema', '@juno/fake-slack']
const agentBans = new Map([
  ['@juno/agent', [...agentSlackBan, '@juno/store', '@juno/sync', '@juno/engine', '@juno/state', '@juno/views', '@juno/ui']],
  ['@juno/agent-memory', agentSlackBan],
  ['@juno/agent-cards', agentSlackBan],
  ['@juno/agent-contract', agentSlackBan],
  ['@juno/agent-juno', agentSlackBan],
  ['@juno/agent-testing', agentSlackBan],
])
const agentBanReason =
  'Juno Agent packages are portable: none imports Electron or Slack, and the core does not import the store, sync, engine or UI (docs/juno-agent/plan-v3.md section 2.1).'

const NODE_BUILTIN = '<node built-in>'
const EFFECT_ANY = '<effect>'
const isNodeBuiltin = (spec) =>
  spec.startsWith('node:') || builtinModules.includes(spec) || builtinModules.includes(spec.split('/')[0])

// Directory rules. `dir` is a repo-relative path prefix, or `match` a regex tested on the
// repo-relative path with forward slashes. `ban` lists package names (or NODE_BUILTIN,
// EFFECT_ANY); `allowOnly` is a predicate for the only specifiers the directory may import;
// `except` lists exact specifiers the bans do not apply to.
const dirRules = [
  {
    dir: 'apps/desktop/src/renderer',
    ban: ['@juno/engine', '@juno/store', '@juno/slack', '@juno/fake-slack', 'electron', NODE_BUILTIN],
    reason:
      'The renderer talks to the engine over the port through @juno/state and to main through window.juno. It has no Electron or Node access.',
  },
  {
    dir: 'apps/desktop/src/main',
    ban: ['@juno/state', '@juno/views', '@juno/ui', '@juno/engine', '@juno/store', '@juno/slack', '@juno/agent', 'react', 'react-dom'],
    // The Slack-app import parser (leveldb and cookie files) is plain file reading that main
    // owns (docs/architecture.md section 14) and the live smoke shares. The client stays out.
    except: ['@juno/slack/import'],
    reason: 'Main is the shell: no UI, state or engine code. It forks the engine entry as a separate process.',
  },
  {
    dir: 'apps/desktop/src/engine',
    ban: ['@juno/state', '@juno/views', '@juno/ui', '@juno/agent', 'react', 'react-dom'],
    reason: 'The engine entry is a Node program with no UI code. The agent core runs in its own process (ADR 0012).',
  },
  {
    dir: 'apps/desktop/src/agent',
    ban: ['@juno/engine', '@juno/store', '@juno/sync', '@juno/slack', '@juno/slack-schema', '@juno/state', '@juno/views', '@juno/ui', '@juno/agent-juno', 'react', 'react-dom'],
    reason: 'The agent entry hosts the portable agent core. It reaches Juno only through the AgentHost port (ADR 0012).',
  },
  {
    dir: 'apps/desktop/src/preload',
    allowOnly: (spec) => spec === 'electron' || spec === '@juno/contract/channels' || spec.startsWith('.'),
    reason:
      'The preload may import only electron and @juno/contract/channels (names and types, no runtime imports) so it stays small.',
  },
  {
    match: /(^|\/)views\//,
    ban: ['@juno/state', '@juno/engine', '@juno/store', 'electron', NODE_BUILTIN, EFFECT_ANY],
    reason: 'Views are dumb: props in, callbacks out. No state, Effect, IPC or Electron (docs/architecture.md sections 1 and 8).',
  },
]

// Text patterns banned in src.
const textRules = [
  { re: /\bsendSync\b/, reason: 'ipcRenderer.sendSync blocks the renderer. Use invoke (docs/performance.md 2.1).' },
  {
    re: /\b(?:window|globalThis)\.juno\b/,
    reason: 'Views and ui do not reach the shell bridge. Containers pass callbacks.',
    only: (rel) => /(^|\/)views\//.test(rel) || rel.startsWith('packages/ui/'),
  },
]

// Unstable Effect modules (.claude/skills/effect/SKILL.md, "Unstable modules"). Each may be
// imported only from the listed repo-relative paths (a path ending in "/" is a directory). To
// allow a new place, add it here and record why in the effect skill. `spec` matches the import
// specifier; `names` matches named imports from the root 'effect' module.
const unstable = [
  {
    label: 'Atom, AtomRegistry, AtomRpc and AsyncResult from effect/reactivity',
    spec: /^effect\/reactivity(?:\/(?!Reactivity$).+)?$/,
    allow: ['packages/state/src/', 'packages/engine/test/protocol.test.ts'],
  },
  {
    label: 'effect/reactivity/Reactivity',
    spec: /^effect\/reactivity\/Reactivity$/,
    allow: ['packages/store/src/invalidation.ts'],
  },
  { label: '@effect/atom-react', spec: /^@effect\/atom-react(?:\/|$)/, allow: ['packages/state/src/react.ts'] },
  {
    label: 'effect/rpc',
    spec: /^effect\/rpc(?:\/|$)/,
    allow: [
      'packages/contract/src/', 'packages/engine/src/protocol/', 'packages/state/src/', 'packages/agent-contract/src/host/', 'packages/agent-contract/src/rpc/', 'packages/agent/src/host/',
      'packages/agent/src/serve/', 'packages/engine/test/agent-host.test.ts', 'packages/agent/test/serve-harness.ts',
    ],
  },
  {
    label: 'effect/workers',
    spec: /^effect\/workers(?:\/|$)/,
    allow: ['packages/state/src/transport.ts', 'packages/engine/src/protocol/runner.ts', 'packages/agent/src/host/port.ts', 'packages/agent/src/serve/runner.ts'],
  },
  {
    label: 'effect/sql and @effect/sql-sqlite-node',
    spec: /^(?:effect\/sql(?:\/|$)|@effect\/sql-)/,
    allow: ['packages/store/'],
  },
  {
    label: 'other unstable subpaths',
    spec: /^(?:effect\/(?:http|http-api|socket|persistence|cli|ai|cluster|workflow|observability|process|devtools|eventlog)(?:\/|$)|@effect\/platform)/,
    allow: [],
  },
  {
    label: 'unstable root modules',
    spec: /^effect\/(?:FileSystem|Path|Terminal|Stdio|Newtype|LayerMap|Graph|ExecutionPlan|ErrorReporter|Arbitrary|Crypto)$/,
    names: new Set([
      'FileSystem', 'Path', 'Terminal', 'Stdio', 'Newtype', 'LayerMap', 'Graph', 'ExecutionPlan',
      'ErrorReporter', 'Arbitrary', 'Crypto',
    ]),
    allow: [],
  },
]

// pi and Codex (docs/juno-agent/plan-v3.md section 2.1): each may be imported only from the
// agent directory that wraps it, plus the test doubles in agent-testing. pi-ai is also the
// provider of @juno/ai. koffi follows the same rule for main. Same shape as `unstable`.
const thirdParty = [
  {
    label: 'pi-durable',
    // pi-codemode is pi-durable's code mode sandbox (runtime/codemode.ts).
    spec: /^@earendil-works\/(?:pi-durable|pi-codemode|chord)(?:\/|$)/,
    allow: ['packages/agent/src/runtime/', 'packages/agent-testing/'],
  },
  { label: 'pi-mcp', spec: /^@earendil-works\/pi-mcp(?:\/|$)/, allow: ['packages/agent/src/mcp/', 'packages/agent-testing/'] },
  // koffi (ADR 0015): a native FFI module in main, for the private window-server call that tells
  // Juno the screen is shared, and for macOS's notification permission. Keep it to those files.
  { label: 'koffi', spec: /^koffi(?:\/|$)/, allow: ['apps/desktop/src/main/screenWatch.ts', 'apps/desktop/src/main/notificationPermission.ts'], doc: 'docs/decisions/0015-koffi-for-screen-share-detection.md' },
  {
    label: 'pi-ai and the Codex SDK',
    spec: /^(?:@earendil-works\/pi-ai|@openai\/codex-sdk)(?:\/|$)/,
    allow: ['packages/agent/src/providers/', 'packages/agent-testing/', 'packages/ai/'],
  },
]

// Engine feature folders (docs/architecture.md section 3): a folder under packages/engine/src
// other than the shared ones is a feature. It may not import another feature or the composition files.
const engineSrc = 'packages/engine/src'
const engineSharedFolders = new Set(['protocol'])
const engineCompositionFiles = new Set(['layer', 'startEngine', 'index'])

function subdirs(dir) {
  const abs = join(root, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .map((name) => join(abs, name))
    .filter((path) => statSync(path).isDirectory())
}

function sourceFiles(dir) {
  const files = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
    }
  }
  if (existsSync(dir)) walk(dir)
  return files
}

// The files a package's checks scan: src, test and e2e recursively, plus top-level ts files.
function scannedFiles(pkgDir) {
  const files = ['src', 'test', 'e2e'].flatMap((name) => sourceFiles(join(pkgDir, name)))
  for (const entry of readdirSync(pkgDir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(ts|tsx|mts)$/.test(entry.name)) files.push(join(pkgDir, entry.name))
  }
  return files
}

function juneDeps(json) {
  const names = new Set()
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(json[field] ?? {})) {
      if (name.startsWith('@juno/')) names.add(name)
    }
  }
  return names
}

function readList(pkg, key) {
  const value = pkg.json.juno?.[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.startsWith('@juno/'))) {
    errors.push(`${pkg.rel}/package.json: juno.${key} must be an array of @juno/* package names`)
    return []
  }
  return value
}

// Package name of an import specifier, e.g. '@juno/slack/schemas' -> '@juno/slack'.
function packageOf(spec) {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

// Named imports in an import clause, e.g. "{ Schema as S, type X }" -> ['Schema', 'X'].
// Returns null when the clause is not a plain named-import list (default or namespace import).
function namedImports(clause) {
  if (!clause) return null
  const match = clause.trim().match(/^(?:type\s+)?\{([\s\S]*)\}$/)
  if (!match) return null
  return match[1]
    .split(',')
    .map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
    .filter(Boolean)
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function importsOf(text) {
  const found = []
  const patterns = [
    { re: /\b(?:import|export)\s+((?:type\s+)?[^'"`;]*?)\s*\bfrom\s*['"]([^'"\n]+)['"]/g, clause: 1, spec: 2 },
    { re: /\bimport\s*['"]([^'"\n]+)['"]/g, clause: null, spec: 1 },
    { re: /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g, clause: null, spec: 1 },
    { re: /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g, clause: null, spec: 1 },
  ]
  for (const { re, clause, spec } of patterns) {
    for (const match of text.matchAll(re)) {
      found.push({ spec: match[spec], clause: clause === null ? '' : match[clause] })
    }
  }
  return found
}

// 1. Discover workspace packages.
const packages = []
for (const dir of [...subdirs('apps'), ...subdirs('packages')]) {
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) continue
  const json = JSON.parse(readFileSync(manifest, 'utf8'))
  packages.push({ name: json.name, dir, rel: relative(root, dir), json, declared: juneDeps(json) })
}
const byName = new Map(packages.map((pkg) => [pkg.name, pkg]))

// 2 and 3. Check declared edges against the allowed graph, and check for cycles.
const graph = new Map()
let edgeCount = 0
for (const pkg of packages) {
  if (!pkg.json.juno || !Array.isArray(pkg.json.juno.allowedDeps)) {
    errors.push(`${pkg.name}: package.json has no juno.allowedDeps array (use [] for no @juno dependencies)`)
  }
  const allowed = new Set(readList(pkg, 'allowedDeps'))
  const exceptions = new Set(readList(pkg, 'exceptions'))
  const testDeps = new Set(readList(pkg, 'testDeps'))
  const devOnly = new Set(Object.keys(pkg.json.devDependencies ?? {}))
  graph.set(pkg.name, [])

  for (const dep of pkg.declared) {
    edgeCount++
    if (dep === pkg.name) {
      errors.push(`${pkg.name}: depends on itself`)
      continue
    }
    if (!byName.has(dep)) {
      errors.push(`${pkg.name}: depends on ${dep}, which is not a workspace package`)
      continue
    }
    // A test-only edge: allowed as a devDependency for tests, never imported from src
    // (the src import scan below enforces that), and left out of the cycle check.
    if (testDeps.has(dep) && devOnly.has(dep) && !allowed.has(dep)) continue
    graph.get(pkg.name).push(dep)
    if (allowed.has(dep)) continue
    if (exceptions.has(dep)) {
      warnings.push(`${pkg.name} depends on ${dep}, which is outside the architecture graph (listed in juno.exceptions)`)
      continue
    }
    errors.push(
      `${pkg.name} depends on ${dep}, which is not in its allowed list ` +
        `(allowed: ${[...allowed].join(', ') || 'none'}). See docs/architecture.md section 3.`,
    )
  }

  for (const banned of agentBans.get(pkg.name) ?? []) {
    const declared = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some((field) => pkg.json[field]?.[banned] !== undefined)
    if (declared) errors.push(`${pkg.name}: declares ${banned}. ${agentBanReason}`)
  }

  for (const dep of exceptions) {
    if (!pkg.declared.has(dep)) {
      errors.push(`${pkg.name}: juno.exceptions lists ${dep}, but package.json does not declare it. Remove it from the list.`)
    }
  }
}

const state = new Map()
const cyclePath = []
function visit(name) {
  if (state.get(name) === 'done') return false
  if (state.get(name) === 'active') {
    cyclePath.push(name)
    return true
  }
  state.set(name, 'active')
  cyclePath.push(name)
  for (const dep of graph.get(name) ?? []) {
    if (visit(dep)) return true
  }
  cyclePath.pop()
  state.set(name, 'done')
  return false
}
for (const pkg of packages) {
  cyclePath.length = 0
  if (visit(pkg.name)) {
    const start = cyclePath.indexOf(cyclePath.at(-1))
    errors.push(`dependency cycle: ${cyclePath.slice(start).join(' -> ')}`)
    break
  }
}

// 4 and 5. Scan imports for undeclared @juno packages and for the hard rules.
// The package rules (effect, state, testDeps) apply to src only; the others to src, test and e2e.
function underAllowed(rel, allow) {
  return allow.some((entry) => (entry.endsWith('/') ? rel.startsWith(entry) : rel === entry))
}

// The feature folder a repo-relative engine path belongs to, or null (shared folder or top-level file).
function engineFeatureOf(rel) {
  if (!rel.startsWith(`${engineSrc}/`)) return null
  const parts = rel.slice(engineSrc.length + 1).split('/')
  if (parts.length < 2) return null
  return engineSharedFolders.has(parts[0]) ? null : parts[0]
}

let fileCount = 0
for (const pkg of packages) {
  const srcPrefix = join(pkg.dir, 'src') + sep
  for (const file of scannedFiles(pkg.dir)) {
    fileCount++
    const isSrc = file.startsWith(srcPrefix)
    const where = relative(root, file)
    const rel = where.split(sep).join('/')
    const text = stripComments(readFileSync(file, 'utf8'))

    for (const rule of textRules) {
      if (isSrc && (rule.only?.(rel) ?? true) && rule.re.test(text)) {
        errors.push(`${where}: matches ${rule.re}. ${rule.reason}`)
      }
    }

    for (const { spec, clause } of importsOf(text)) {
      const target = packageOf(spec)
      const isEffect = spec === 'effect' || spec.startsWith('effect/') || spec.startsWith('@effect/')

      if (target === 'electron' && pkg.name !== electronOwner) {
        errors.push(`${where}: imports electron. Only ${electronOwner} may import electron.`)
      }

      if ((agentBans.get(pkg.name) ?? []).includes(target)) errors.push(`${where}: imports ${spec}. ${agentBanReason}`)

      for (const rule of thirdParty) {
        if (rule.spec.test(spec) && !underAllowed(rel, rule.allow)) {
          errors.push(`${where}: imports ${spec}; only ${rule.allow.join(', ')} may import ${rule.label}. Wrap it there (${rule.doc ?? 'docs/juno-agent/plan-v3.md section 2.1'}).`)
        }
      }

      for (const rule of dirRules) {
        if (rule.dir ? !rel.startsWith(`${rule.dir}/`) : !rule.match.test(rel)) continue
        if ((rule.except ?? []).includes(spec)) continue
        const banned = (rule.ban ?? []).some((item) =>
          item === NODE_BUILTIN ? isNodeBuiltin(spec) : item === EFFECT_ANY ? isEffect : target === item,
        )
        if (banned || (rule.allowOnly && !rule.allowOnly(spec))) errors.push(`${where}: imports ${spec}. ${rule.reason}`)
      }

      for (const rule of unstable) {
        const named = rule.names && spec === 'effect' ? (namedImports(clause) ?? []).filter((name) => rule.names.has(name)) : []
        if ((rule.spec.test(spec) || named.length > 0) && !underAllowed(rel, rule.allow)) {
          const who = rule.allow.length > 0 ? `only ${rule.allow.join(', ')} may import it` : 'no file may import it yet'
          errors.push(
            `${where}: imports ${named.length > 0 ? `${named.join(', ')} from 'effect'` : spec}, an unstable Effect module (${rule.label}); ${who}. ` +
              'Use the wrapper, or add the path to `unstable` in scripts/check-deps.mjs and record why in .claude/skills/effect/SKILL.md.',
          )
        }
      }

      const feature = engineFeatureOf(rel)
      if (feature && spec.startsWith('.')) {
        const targetRel = relative(root, resolve(dirname(file), spec)).split(sep).join('/')
        const isFile = ['.ts', '.tsx'].some((ext) => existsSync(resolve(root, targetRel + ext)))
        const targetFeature = engineFeatureOf(isFile ? `${targetRel}.ts` : `${targetRel}/index.ts`)
        const topLevel = targetRel.startsWith(`${engineSrc}/`) ? targetRel.slice(engineSrc.length + 1) : null
        if ((targetFeature && targetFeature !== feature) || (topLevel && engineCompositionFiles.has(topLevel))) {
          errors.push(`${where}: imports ${spec}. Engine feature folders do not import each other or the composition files (docs/architecture.md section 3).`)
        }
      }

      if (isSrc && noEffect.has(pkg.name) && isEffect) {
        const names = namedImports(clause)
        const isSchemaOnly = schemaOnlyEffect.has(pkg.name) && spec === 'effect' && names !== null && names.length > 0 && names.every((name) => name === 'Schema')
        if (!isSchemaOnly) {
          errors.push(`${where}: imports ${spec}. ${pkg.name} must not import effect${schemaOnlyEffect.has(pkg.name) ? ' except { Schema } from \'effect\'' : ''}.`)
        }
      }

      if (isSrc && noState.has(pkg.name) && target === '@juno/state') {
        errors.push(`${where}: imports @juno/state. ${pkg.name} must not import @juno/state.`)
      }

      if (isSrc && (pkg.json.juno?.testDeps ?? []).includes(target) && !(pkg.json.juno?.allowedDeps ?? []).includes(target)) {
        errors.push(`${where}: imports ${target}, which ${pkg.name} may only use in tests (juno.testDeps).`)
      }

      if (target.startsWith('@juno/') && target !== pkg.name && !pkg.declared.has(target)) {
        errors.push(`${where}: imports ${target}, which ${pkg.name} does not declare in package.json.`)
      }
    }
  }
}

for (const warning of warnings) console.warn(`check-deps: warn: ${warning}`)

if (errors.length > 0) {
  console.error(`check-deps: ${errors.length} error(s):`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(
  `check-deps: ok (${packages.length} packages, ${edgeCount} @juno edges, ${fileCount} files, ${warnings.length} known exception(s))`,
)
