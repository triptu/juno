#!/usr/bin/env node
/**
 * Sets the app's version in apps/desktop/package.json (docs/development.md,
 * "Releasing"). `pnpm release:version patch|minor|major|<x.y.z>`. Refuses to
 * go backwards. Commit the result before packaging.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compareVersions, isVersion, normalizeVersion } from '../apps/desktop/src/main/releaseNotes.ts'

const file = join(resolve(import.meta.dirname, '..'), 'apps/desktop/package.json')
const text = readFileSync(file, 'utf8')
const current = String(JSON.parse(text).version)
const bump = process.argv[2]
const [major, minor, patch] = current.split(/[.-]/).map(Number) as [number, number, number]
const next = bump === 'major' ? `${major + 1}.0.0`
  : bump === 'minor' ? `${major}.${minor + 1}.0`
  : bump === 'patch' ? `${major}.${minor}.${patch + 1}`
  : bump !== undefined && isVersion(bump) ? normalizeVersion(bump)
  : undefined
if (next === undefined) {
  console.error('Usage: pnpm release:version patch|minor|major|<x.y.z>')
  process.exit(1)
}
if (compareVersions(next, current) <= 0) {
  console.error(`release:version: ${next} is not newer than ${current}`)
  process.exit(1)
}
writeFileSync(file, text.replace(`"version": "${current}"`, `"version": "${next}"`))
console.log(`release:version: ${current} -> ${next}`)
