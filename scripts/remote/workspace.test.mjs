import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { imageTag, imageContext } from './image.mjs'
import { runnerCache } from './runner.mjs'

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

test('Linux caches belong to the SSH uid and reject a different owner', { skip: process.platform !== 'linux' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-cache-owner-'))
  try {
    const run = () => spawnSync('bash', ['-c', `${runnerCache()}; echo ready`], { env: { ...process.env, HOME: dir, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8' })
    const valid = run()
    assert.equal(valid.status, 0, valid.stderr)
    assert.match(valid.stdout, /ready/)
    writeFileSync(join(dir, 'stat'), '#!/bin/sh\necho 4294967294\n')
    chmodSync(join(dir, 'stat'), 0o755)
    const mismatch = run()
    assert.equal(mismatch.status, 70)
    assert.match(mismatch.stderr, /cache must belong to the SSH user/)
    assert.doesNotMatch(mismatch.stdout, /ready/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
