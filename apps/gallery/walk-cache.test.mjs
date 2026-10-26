import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { sampleShare, testCache, walkCache } from './walk-cache.mjs'

const tokens = [
  "import * as stylex from '@stylexjs/stylex'",
  'export const colors = stylex.defineVars({',
  "  '--ink': 'hsla(48, 5%, 20%, 1)',",
  "  '--edge': '0 0 0 1px oklch(0 0 0 / 0.1)',",
  '})',
  'export const spacing = stylex.defineVars({',
  "  '--unit': '4px',",
  "  '--gap': `calc(${spacing['--unit']} * 2)`,",
  "  '--unused': '1px',",
  '})',
].join('\n')
const themes = `import * as stylex from '@stylexjs/stylex'
import { colors, spacing } from './tokens.stylex'
export const dark = stylex.createTheme(colors, { '--ink': 'hsla(48, 5%, 90%, 1)' })
export const compact = stylex.createTheme(spacing, { '--unit': '3px' })
`
const lock = versions => JSON.stringify({
  lockfileVersion: 1,
  workspaces: { 'apps/gallery': { name: '@juno/gallery', devDependencies: { vite: '7' } }, 'packages/ui': { name: '@juno/ui' }, 'packages/tokens': { name: '@juno/tokens' }, 'packages/views': { name: '@juno/views' }, 'packages/testing': { name: '@juno/testing' }, 'apps/desktop': { name: '@juno/desktop', dependencies: { electron: '30' } } },
  packages: Object.fromEntries(Object.entries(versions).map(([name, version]) => [name, [`${name}@${version}`, '', {}, 'sha']])),
})

function fixture(t) {
  const scratch = '/Volumes/AgentWork/scratch'
  const root = mkdtempSync(join(existsSync(scratch) ? scratch : tmpdir(), 'gallery-cache-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text) }
  write('packages/ui/package.json', JSON.stringify({ name: '@juno/ui', exports: { '.': './src/index.ts' } }))
  write('packages/ui/src/index.ts', "export { Button } from './Button'\nexport { Other } from './Other'")
  write('packages/ui/src/Button.ts', "import { colors, spacing } from '@juno/tokens/tokens.stylex'\nimport { width } from './width'\nexport const Button = [width, spacing['--gap'], colors['--ink'], colors['--edge']]")
  write('packages/ui/src/width.ts', 'export const width = 20')
  write('packages/ui/src/Other.ts', 'export const Other = 2')
  write('packages/views/package.json', JSON.stringify({ name: '@juno/views' }))
  write('packages/views/src/Button.fixtures.ts', "import { Button } from '@juno/ui'\nexport default Button")
  write('packages/views/src/Other.fixtures.ts', "import { Other } from '@juno/ui'\nexport default Other")
  write('packages/views/src/fixtures.ts', "import Button, { secondary } from './Button.fixtures'\nimport Other from './Other.fixtures'\nexport const fixtures = {\n Button,\n Alias: secondary,\n Other,\n}\n")
  write('apps/gallery/src/registry.ts', '// registry')
  write('packages/tokens/package.json', JSON.stringify({ name: '@juno/tokens', exports: { './tokens.stylex': './src/tokens.stylex.ts', './themes.stylex': './src/themes.stylex.ts' } }))
  write('packages/tokens/src/tokens.stylex.ts', tokens)
  write('packages/tokens/src/themes.stylex.ts', themes)
  write('apps/gallery/shift-walk.ts', "import { guard } from '@juno/testing/layout-shift'\nexport const walk = guard")
  write('packages/testing/package.json', JSON.stringify({ name: '@juno/testing', exports: { './layout-shift': './src/layoutShift.ts' } }))
  write('packages/testing/src/layoutShift.ts', 'export const guard = 1')
  write('package.json', JSON.stringify({ name: 'juno', scripts: { test: 'bun test' } }))
  write('apps/gallery/package.json', JSON.stringify({ name: '@juno/gallery', devDependencies: { vite: '7' } }))
  write('bun.lock', lock({ vite: '7.0.0', electron: '30.0.0' }))
  const directory = join(root, 'cache')
  const runtime = { playwright: '1', chromium: '2', platform: 'linux', arch: 'x64', viewport: [1280, 800] }
  const cache = (extra = {}) => walkCache({ root, directory, runtime, kind: 'shift', ...extra })
  const route = component => ({ component, route: `${component}/one`, id: 'one', frame: {} })
  return { root, write, directory, runtime, cache, button: route('Button'), alias: route('Alias'), other: route('Other') }
}

test('transitive source and named fixture aliases invalidate only their components', t => {
  const { cache, write, button, alias, other } = fixture(t)
  const before = cache()
  for (const route of [button, alias, other]) before.pass(route)
  write('packages/ui/src/width.ts', 'export const width = 21')
  const after = cache()
  assert.equal(after.passed(button), false)
  assert.equal(after.passed(alias), false)
  assert.equal(after.passed(other), true)
  assert.equal(after.passed({ ...other, id: 'two', route: 'Other/two' }), false)
})

test('dynamic imports, fixtures, fonts, build inputs and the walk itself invalidate successful states', t => {
  const { root, cache, write, button } = fixture(t)
  write('packages/ui/src/Button.ts', "export const Button = () => import('./lazy')")
  write('packages/ui/src/lazy.ts', 'export const size = 1')
  for (const file of ['packages/ui/src/lazy.ts', 'packages/views/src/Button.fixtures.ts', 'packages/tokens/src/global.css', 'packages/tokens/src/font.woff2', 'apps/gallery/dist/assets/font.woff2', 'apps/gallery/vite.config.ts', 'apps/gallery/.env.local', 'apps/gallery/shift-walk.ts', 'packages/testing/src/layoutShift.ts']) {
    const before = cache()
    before.pass(button)
    let old = ''
    try { old = readFileSync(join(root, file), 'utf8') } catch {}
    write(file, `${old}\n// changed`)
    assert.equal(cache().passed(button), false, file)
  }
})

test('browser, Playwright, OS, architecture, options and guard identity belong to the key', t => {
  const { cache, runtime, button } = fixture(t)
  cache().pass(button)
  for (const field of Object.keys(runtime)) {
    assert.equal(cache({ runtime: { ...runtime, [field]: 'changed' } }).passed(button), false, field)
  }
})

test('full runs bypass old passes; failed, incomplete and corrupt records never pass', t => {
  const { cache, directory, button } = fixture(t)
  const check = cache()
  assert.equal(check.passed(button), false)
  check.pass(button)
  assert.equal(cache().passed(button), true)
  const full = cache({ all: true })
  assert.equal(full.passed(button), false)
  full.forget(button)
  assert.equal(cache().passed(button), false)
  full.pass(button)
  assert.equal(cache().passed(button), true)
  writeFileSync(join(directory, check.key(button)), 'partial')
  assert.equal(cache().passed(button), false)
})

test('a full run reuses passes by the run that wrote them and walks its seed\'s sample of them again', t => {
  const { cache, directory, button } = fixture(t)
  const routes = Array.from({ length: 2000 }, (_, index) => ({ ...button, id: `s${index}`, route: `Button/s${index}` }))
  const affected = cache({ kind: 'computed', source: 'gallery run at noon' })
  for (const route of routes) affected.pass(route)
  const picked = seed => {
    const sampled = cache({ kind: 'computed', sample: seed })
    return routes.filter(route => sampled.reuse(route)?.sampled).map(route => route.route)
  }
  const first = picked('11')
  assert.ok(Math.abs(first.length - routes.length * sampleShare) < 40, `${first.length} of ${routes.length} sampled`)
  assert.deepEqual(picked('11'), first, 'every worker picks the same states for one seed')
  assert.ok(picked('12').filter(route => first.includes(route)).length < first.length / 4, 'a new seed picks other states')
  const reuse = cache({ kind: 'computed', sample: '11' }).reuse(routes[0])
  assert.equal(reuse.from, 'gallery run at noon')
  // A record from before sources still counts; anything after the first line other than a source does not.
  writeFileSync(join(directory, affected.key(button)), 'computed Button/one\n')
  assert.equal(affected.reuse(button).from, 'an earlier run')
  writeFileSync(join(directory, affected.key(button)), 'computed Button/one\npartial')
  assert.equal(affected.reuse(button), undefined)
  // The real-input walk has no sample: its records are its own.
  cache().pass(button)
  assert.equal(cache({ sample: undefined }).reuse(button).sampled, false)
})

test('unknown registrations fail closed to all sources; the gallery\'s compositions key on what they import', t => {
  const { cache, write, button } = fixture(t)
  write('apps/gallery/src/compositions.tsx', "import { Button } from '@juno/ui'\nexport const compositions = {\n  Pair: defineFixtures(Button),\n}\n")
  const unknown = { ...button, component: 'Composition', route: 'Composition/one' }
  const pair = { ...button, component: 'Pair', route: 'Pair/one' }
  cache().pass(unknown)
  cache().pass(pair)
  write('packages/ui/src/Other.ts', 'export const Other = 3')
  assert.equal(cache().passed(unknown), false)
  assert.equal(cache().passed(pair), true)
  write('packages/ui/src/width.ts', 'export const width = 22')
  assert.equal(cache().passed(pair), false)
})

test('a state keys on the layout tokens it reads, in every theme, and on what they read', t => {
  const { root, cache, write, button, other } = fixture(t)
  const change = (from, to) => write('packages/tokens/src/tokens.stylex.ts', readFileSync(join(root, 'packages/tokens/src/tokens.stylex.ts'), 'utf8').replace(from, to))
  const changeTheme = (from, to) => write('packages/tokens/src/themes.stylex.ts', readFileSync(join(root, 'packages/tokens/src/themes.stylex.ts'), 'utf8').replace(from, to))
  const passes = edit => {
    const before = cache()
    for (const route of [button, other]) before.pass(route)
    edit()
    const after = cache()
    return [after.passed(button), after.passed(other)]
  }
  // Colours and shadows cannot move a box; neither can a token nobody reads, or a comment.
  assert.deepEqual(passes(() => change("'hsla(48, 5%, 20%, 1)'", "'hsla(200, 50%, 20%, 1)'")), [true, true])
  assert.deepEqual(passes(() => changeTheme("'hsla(48, 5%, 90%, 1)'", "'#fff'")), [true, true])
  assert.deepEqual(passes(() => change("1px oklch", "2px oklch")), [true, true])
  assert.deepEqual(passes(() => change("'--unused': '1px'", "'--unused': '2px',\n  '--added': '9px'")), [true, true])
  assert.deepEqual(passes(() => change('export const colors', '// Colours.\nexport const colors')), [true, true])
  // A layout value Button reads, the token it reads in turn, and a theme's override of it.
  assert.deepEqual(passes(() => change('* 2', '* 3')), [false, true])
  assert.deepEqual(passes(() => change("'--unit': '4px'", "'--unit': '5px'")), [false, true])
  assert.deepEqual(passes(() => changeTheme("'3px'", "'2px'")), [false, true])
  // A colour that becomes a length is read as layout from then on.
  assert.deepEqual(passes(() => change("'hsla(200, 50%, 20%, 1)'", "'2px'")), [false, true])
  // A group indexed by a variable reads all of it.
  write('packages/ui/src/Other.ts', "import { spacing } from '@juno/tokens/tokens.stylex'\nexport const Other = (key) => spacing[key]")
  assert.deepEqual(passes(() => change("'--unused': '2px'", "'--unused': '3px'")), [true, false])
})

test('spec-only tests, scripts and packages outside the gallery do not invalidate states', t => {
  const { root, cache, write, button } = fixture(t)
  for (const [file, text] of [
    ['apps/gallery/shift.spec.ts', "test('the guard itself', () => {})"],
    ['apps/gallery/playwright.config.ts', 'export default { workers: 8 }'],
    ['apps/gallery/src/compositions.tsx', 'export const compositions = {}'],
    ['package.json', JSON.stringify({ name: 'juno', scripts: { test: 'bun test --randomize' } })],
    ['bun.lock', lock({ vite: '7.0.0', electron: '31.0.0' })],
  ]) {
    cache().pass(button)
    write(file, text)
    assert.equal(cache().passed(button), true, file)
  }
  cache().pass(button)
  write('bun.lock', lock({ vite: '7.0.1', electron: '31.0.0' }))
  assert.equal(cache().passed(button), false, 'a gallery build tool')
  cache().pass(button)
  write('bun.lock', `${readFileSync(join(root, 'bun.lock'), 'utf8')} not json`)
  assert.equal(cache().passed(button), false, 'an unreadable lockfile counts whole')
})

test('a cached rendering test keys on its spec, the components it opened and, for paint, every colour', t => {
  const { root, write, directory, runtime } = fixture(t)
  write('apps/gallery/support.ts', 'export const open = 1')
  write('apps/gallery/rows.spec.ts', "import { open } from './support'\nexport const spec = open")
  const spec = 'apps/gallery/rows.spec.ts'
  const cache = (kind = 'layout', extra = {}) => testCache({ root, directory, runtime, kind, ...extra })
  const passes = (kind, edit, opened = ['Button']) => {
    cache(kind).pass(spec, 'rows', opened)
    edit()
    return cache(kind).passed(spec, 'rows')
  }
  const tokens = () => readFileSync(join(root, 'packages/tokens/src/tokens.stylex.ts'), 'utf8')
  assert.equal(cache().passed(spec, 'rows'), false, 'never run')
  // Only what it opened counts.
  assert.equal(passes('layout', () => write('packages/ui/src/Other.ts', 'export const Other = 3')), true)
  assert.equal(passes('layout', () => write('packages/ui/src/width.ts', 'export const width = 30')), false)
  assert.equal(passes('layout', () => write('packages/ui/src/width.ts', 'export const width = 31'), ['#index']), true)
  assert.equal(passes('layout', () => write('packages/views/src/Other.fixtures.ts', "import { Other } from '@juno/ui'\nexport default [Other]"), ['#index']), false)
  // The spec and what it imports.
  assert.equal(passes('layout', () => write('apps/gallery/support.ts', 'export const open = 2')), false)
  // A colour the component reads counts for paint only; one it does not read never counts.
  assert.equal(passes('layout', () => write('packages/tokens/src/tokens.stylex.ts', tokens().replace('20%, 1)', '25%, 1)'))), true)
  assert.equal(passes('paint', () => write('packages/tokens/src/tokens.stylex.ts', tokens().replace('25%, 1)', '30%, 1)'))), false)
  assert.equal(passes('paint', () => write('packages/tokens/src/tokens.stylex.ts', tokens().replace("'--unused': '1px'", "'--unused': '2px',\n  '--tint': 'red'"))), true)
  // A full run reruns it, and a run that does not finish leaves no pass behind.
  cache().pass(spec, 'rows', ['Button'])
  assert.equal(cache('layout', { all: true }).passed(spec, 'rows'), false)
  cache().forget(spec, 'rows')
  assert.equal(cache().passed(spec, 'rows'), false)
})

test('a computed pass never authorizes real input, and each guard invalidates its own records', t => {
  const { cache, write, button, other } = fixture(t)
  write('apps/gallery/computed-walk.ts', "import { forced } from './forced'\nexport const walk = forced")
  write('apps/gallery/forced.ts', 'export const forced = 1')
  const computed = () => cache({ kind: 'computed' })
  computed().pass(button)
  assert.equal(cache().passed(button), false)
  for (const route of [button, other]) { cache().pass(route); computed().pass(route) }
  write('apps/gallery/forced.ts', 'export const forced = 2')
  assert.equal(computed().passed(button), false)
  assert.equal(cache().passed(button), true)
  computed().pass(button)
  write('packages/ui/src/width.ts', 'export const width = 22')
  assert.equal(computed().passed(button), false)
  assert.equal(cache().passed(button), false)
  assert.equal(cache().passed(other), true)
  // A failed forced check loses only its own pass, never the real-input pass.
  cache().pass(button)
  computed().pass(button)
  computed().forget(button)
  assert.equal(computed().passed(button), false)
  assert.equal(cache().passed(button), true)
})
