import { toolFixture } from './tool-test-fixture.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { buildInputs, builds, sourceFiles } from './build-inputs.mjs'

const repo = resolve(import.meta.dirname, '..')
const tracked = sourceFiles(repo)
const commands = { 'apps/desktop out': ['bun', 'run', 'build'], 'apps/desktop dist': ['bun', 'run', 'build:web'], 'apps/desktop dom/dist': ['bun', 'run', 'build:dom'], 'apps/gallery dist': ['vite', 'build'] }
// Files no build bundles: tests, e2e specs, docs and repo tools.
const outside = ['packages/engine/test/ai.test.ts', 'apps/desktop/e2e/app.spec.ts', 'apps/desktop/dom/live.test.ts', 'apps/gallery/shift-walk.ts', 'docs/development.md', 'scripts/remote/plan.mjs', 'scripts/build-cached.test.mjs']

/** This checkout's inputs of one build, plus the outside files, copied without Git so build-cached walks them as a remote archive does. */
function copyOf(t, build, inputs) {
  const { root, env } = toolFixture(t)
  for (const file of [...inputs, ...outside, 'package.json', 'bun.lock']) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    // A remote archive has no docs.
    if (existsSync(join(repo, file))) cpSync(join(repo, file), join(root, file))
    else writeFileSync(join(root, file), 'outside\n')
  }
  const [app, outDir] = build.split(' ')
  const run = () => {
    const result = spawnSync(process.execPath, [join(repo, 'scripts/build-cached.mjs'), '--key', outDir, ...commands[build]], { cwd: join(root, app), encoding: 'utf8', env: { ...env, GIT_CEILING_DIRECTORIES: dirname(root) } })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  return { root, run, key: () => run().trim().split('\n').at(-1) }
}

for (const build of Object.keys(builds)) {
  test(`${build} keys on its module graph`, (t) => {
    const inputs = buildInputs(repo, tracked, ...build.split(' '))
    // A graph the walk cannot follow keys on all source: safe, but every commit rebuilds.
    assert.deepEqual(inputs.widened, undefined)
    for (const file of outside) assert.ok(!inputs.files.includes(file), `${file} is not bundled`)
    const { root, key } = copyOf(t, build, inputs.files)
    const before = key()
    for (const file of outside) appendFileSync(join(root, file), '\n// changed\n')
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ ...manifest, scripts: { ...manifest.scripts, extra: 'true' } }))
    assert.equal(key(), before, 'tests, docs, tools and root scripts do not change the key')

    // A sample across the graph: the configs, then evenly spaced source files.
    const source = inputs.files.filter((file) => /\.(tsx?|mjs|css|html)$/.test(file))
    const sample = [...builds[build].configs, ...Array.from({ length: 4 }, (_, index) => source[Math.floor(index * source.length / 4)])]
    let last = before
    for (const file of sample) {
      appendFileSync(join(root, file), '\n// changed\n')
      const next = key()
      assert.notEqual(next, last, `${file} changes the key`)
      last = next
    }
  })
}

test('an import the graph cannot follow keys on all source, and the lockfile counts only what is imported', (t) => {
  const build = 'apps/gallery dist'
  const inputs = buildInputs(repo, tracked, 'apps/gallery', 'dist')
  const { root, key, run } = copyOf(t, build, [...inputs.files, 'packages/engine/src/index.ts'])
  const before = key()
  const lock = readFileSync(join(root, 'bun.lock'), 'utf8')
  // @electron/fuses is a desktop packaging tool; the gallery imports react.
  writeFileSync(join(root, 'bun.lock'), lock.replace(/("@electron\/fuses": \["@electron\/fuses@)[^"]+/, (_, entry) => `${entry}0.0.1`))
  assert.equal(key(), before)
  writeFileSync(join(root, 'bun.lock'), lock.replace(/("react": \["react@)[^"]+/, (_, entry) => `${entry}0.0.1`))
  assert.notEqual(key(), before)
  writeFileSync(join(root, 'bun.lock'), lock)
  assert.equal(key(), before)

  appendFileSync(join(root, 'packages/engine/src/index.ts'), '\n// changed\n')
  assert.equal(key(), before, 'the engine is outside the gallery')
  for (const line of ["\nimport.meta.glob('./pages/*.tsx')\n", "\nimport('./pages/' + name)\n", "\nimport './missing'\n"]) {
    const main = join(root, 'apps/gallery/src/main.tsx')
    const text = readFileSync(main, 'utf8')
    appendFileSync(main, line)
    assert.match(run(), /keying dist\/ on all source/)
    const wide = key()
    appendFileSync(join(root, 'packages/engine/src/index.ts'), '\n// changed\n')
    assert.notEqual(key(), wide, `${line.trim()} widens the key to all source`)
    writeFileSync(main, text)
  }
})
