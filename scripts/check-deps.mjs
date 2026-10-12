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
// an undeclared @juno package in src, and the hard rules below.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const warnings = []

// Packages whose src may import only effect's Schema (exactly that named import
// from the root 'effect' module, as used today by domain/ids.ts).
const schemaOnlyEffect = new Set(['@juno/domain', '@juno/richtext'])
// Packages whose src must not import effect at all.
const noEffect = new Set(['@juno/ui', '@juno/tokens', '@juno/views', '@juno/domain', '@juno/richtext'])
// Packages whose src must not import @juno/state.
const noState = new Set(['@juno/ui', '@juno/views'])
// The only package allowed to import electron.
const electronOwner = '@juno/desktop'

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

// 4 and 5. Scan src imports for undeclared @juno packages and for the hard rules.
let fileCount = 0
for (const pkg of packages) {
  for (const file of sourceFiles(join(pkg.dir, 'src'))) {
    fileCount++
    const where = relative(root, file)
    const text = stripComments(readFileSync(file, 'utf8'))
    for (const { spec, clause } of importsOf(text)) {
      const target = packageOf(spec)

      if (target === 'electron' && pkg.name !== electronOwner) {
        errors.push(`${where}: imports electron. Only ${electronOwner} may import electron.`)
      }

      if (noEffect.has(pkg.name) && (spec === 'effect' || spec.startsWith('effect/') || spec.startsWith('@effect/'))) {
        const names = namedImports(clause)
        const isSchemaOnly = schemaOnlyEffect.has(pkg.name) && spec === 'effect' && names !== null && names.length > 0 && names.every((name) => name === 'Schema')
        if (!isSchemaOnly) {
          errors.push(`${where}: imports ${spec}. ${pkg.name} must not import effect${schemaOnlyEffect.has(pkg.name) ? ' except { Schema } from \'effect\'' : ''}.`)
        }
      }

      if (noState.has(pkg.name) && target === '@juno/state') {
        errors.push(`${where}: imports @juno/state. ${pkg.name} must not import @juno/state.`)
      }

      if ((pkg.json.juno?.testDeps ?? []).includes(target) && !(pkg.json.juno?.allowedDeps ?? []).includes(target)) {
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
  `check-deps: ok (${packages.length} packages, ${edgeCount} @juno edges, ${fileCount} src files, ${warnings.length} known exception(s))`,
)
