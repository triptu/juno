// Compiles every renderer-side source file with babel-plugin-react-compiler and with
// oxc-transform-react, prints both through the same Oxc printer (TypeScript removed,
// JSX kept) and reports the files whose output differs, the `_c(n)` memo cache sites
// each side made, and the time each side took.
//
//   bun scripts/react-compiler-compare.mjs [--out <dir>]
//
// With --out, the two outputs of each differing file are written there.
// Runs on Node (`node scripts/react-compiler-compare.mjs`) as well, so it can be
// timed outside Bun.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(join(root, 'apps/desktop/package.json'))
const { transformAsync } = require('@babel/core')
// BABEL_REACT_COMPILER=<path> compares another build of the Babel plugin, such as the experimental one Oxc ports.
const reactCompilerPlugin = require(process.env.BABEL_REACT_COMPILER ?? 'babel-plugin-react-compiler')
const { transform } = await import(require.resolve('oxc-transform-react'))
const { minifySync, parseSync } = await import(require.resolve('vite'))

const outIndex = process.argv.indexOf('--out')
const out = outIndex === -1 ? undefined : resolve(process.argv[outIndex + 1])

const roots = ['apps/desktop/src/renderer', 'apps/gallery/src', ...readdirSync(join(root, 'packages')).map((name) => `packages/${name}/src`)]
const files = []
function walk(dir) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(dir, name)
    if (name === 'node_modules' || name === 'test' || name === '__tests__') continue
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.tsx?$/.test(name) && !/\.(?:test|spec|d)\.tsx?$/.test(name)) files.push(path)
  }
}
for (const dir of roots) walk(join(root, dir))

async function babel(file, code) {
  const skipped = []
  const plugins = file.endsWith('.ts') ? ['typescript'] : ['jsx', 'typescript']
  const result = await transformAsync(code, {
    babelrc: false,
    configFile: false,
    filename: file,
    parserOpts: { sourceType: 'module', allowAwaitOutsideFunction: true, plugins },
    plugins: [[reactCompilerPlugin, { target: '19', logger: { logEvent: (_f, e) => (e.kind === 'CompileError' || e.kind === 'PipelineError') && skipped.push(e.detail?.reason ?? e.kind) } }]],
  })
  return { code: result.code, skipped: skipped.length }
}

async function oxc(file, code) {
  const result = await transform(file, code, { jsx: 'preserve', reactCompiler: { target: '19', reportDiagnostics: true } })
  if (result.fatal) throw new Error(`${file}: ${result.errors.map((e) => e.message).join('\n')}`)
  return { code: result.code, skipped: result.errors.length }
}

/**
 * The same printer for both sides: TypeScript removed, JSX kept, no compiler, comments and
 * layout dropped, then one top-level statement a line in sorted order, since the two place
 * hoisted functions and comments differently.
 */
async function print(file, code) {
  const result = await transform(file, code, { jsx: 'preserve', reactCompiler: false })
  if (result.fatal) throw new Error(`${file}: ${result.errors.map((e) => e.message).join('\n')}`)
  const js = file.replace(/\.tsx?$/, '.jsx')
  const flat = canonical(minifySync(js, result.code, { compress: false, mangle: false }).code)
  const { program } = parseSync(js, flat)
  return program.body.map((statement) => flat.slice(statement.start, statement.end)).sort().join('\n')
}

/** Babel and Oxc number the functions the compiler hoists differently (`_temp0` against `_temp10`); name them by first use. */
function canonical(code) {
  const names = new Map()
  return code.replace(/\b_temp\d*\b/g, (name) => {
    if (!names.has(name)) names.set(name, `_temp${names.size}`)
    return names.get(name)
  })
}

const sites = (code) => (code.match(/\b_c\d*\(\d+\)/g) ?? []).length
const limit = Number(process.env.COMPARE_LIMIT ?? Infinity)
const sources = files.slice(0, limit).map((file) => ({ file, code: readFileSync(file, 'utf8') }))

let start = performance.now()
const babelOut = []
for (const { file, code } of sources) babelOut.push(await babel(file, code))
const babelMs = performance.now() - start
start = performance.now()
const oxcOut = []
for (const { file, code } of sources) oxcOut.push(await oxc(file, code))
const oxcMs = performance.now() - start

const totals = { files: sources.length, same: 0, differ: [], babelSites: 0, oxcSites: 0, babelSkipped: 0, oxcDiagnostics: 0 }
for (let i = 0; i < sources.length; i++) {
  const { file } = sources[i]
  const b = babelOut[i]
  const o = oxcOut[i]
  totals.babelSites += sites(b.code)
  totals.oxcSites += sites(o.code)
  totals.babelSkipped += b.skipped
  totals.oxcDiagnostics += o.skipped
  const [pb, po] = [await print(file, b.code), await print(file, o.code)]
  if (pb === po) totals.same++
  else {
    const name = relative(root, file)
    totals.differ.push({ file: name, babelSites: sites(b.code), oxcSites: sites(o.code) })
    if (out !== undefined) {
      const base = join(out, name.replaceAll('/', '__'))
      mkdirSync(out, { recursive: true })
      writeFileSync(`${base}.babel.js`, pb)
      writeFileSync(`${base}.oxc.js`, po)
    }
  }
}
console.log(JSON.stringify({ ...totals, babelMs: Math.round(babelMs), oxcMs: Math.round(oxcMs) }, null, 2))
