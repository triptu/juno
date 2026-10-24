import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { imageTag, imageContext } from './image.mjs'

test('toolchain tags track only the Dockerfile, Quint and Bun pins, and the context contains no workspace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-toolchain-tag-'))
  let context
  try {
    mkdirSync(join(dir, 'scripts/remote'), { recursive: true })
    writeFileSync(join(dir, 'scripts/remote/Dockerfile'), 'FROM toolchain')
    const manifest = { packageManager: 'bun@1.4.4', devDependencies: { '@informalsystems/quint': '0.33.0' } }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
    const tag = imageTag(dir)
    writeFileSync(join(dir, 'bun.lock'), 'changed lockfile')
    writeFileSync(join(dir, 'bunfig.toml'), 'changed install settings')
    assert.equal(imageTag(dir), tag)
    manifest.packageManager = 'bun@1.4.5'
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
    const bunTag = imageTag(dir)
    assert.notEqual(bunTag, tag)
    manifest.devDependencies['@informalsystems/quint'] = '0.34.0'
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
    assert.notEqual(imageTag(dir), bunTag)
    context = imageContext()
    assert.deepEqual(readdirSync(context).toSorted(), ['Dockerfile', 'toolchain.json'])
  } finally {
    if (context) rmSync(context, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
