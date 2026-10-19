import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { imageTag, imageContext } from './image.mjs'

test('toolchain tags track only the Dockerfile and Quint pin, and the context contains no workspace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-toolchain-tag-'))
  let context
  try {
    mkdirSync(join(dir, 'scripts/remote'), { recursive: true })
    writeFileSync(join(dir, 'scripts/remote/Dockerfile'), 'FROM toolchain')
    const manifest = { devDependencies: { '@informalsystems/quint': '0.33.0', bun: '1.4.3' } }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
    const tag = imageTag(dir)
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'changed lockfile')
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'changed workspace')
    manifest.devDependencies.bun = '1.4.4'
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
    assert.equal(imageTag(dir), tag)
    manifest.devDependencies['@informalsystems/quint'] = '0.34.0'
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
    assert.notEqual(imageTag(dir), tag)
    context = imageContext()
    assert.deepEqual(readdirSync(context).sort(), ['Dockerfile', 'toolchain.json'])
  } finally {
    if (context) rmSync(context, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
