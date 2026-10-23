import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// Only values used to build the toolchain belong in its tag and build context.
function toolchainVersions(directory = root) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  return { quint: manifest.devDependencies['@informalsystems/quint'], bun: manifest.packageManager.replace(/^bun@/, '') }
}

export function imageTag(directory = root) {
  return createHash('sha256').update(readFileSync(join(directory, 'scripts/remote/Dockerfile'))).update(JSON.stringify(toolchainVersions(directory))).digest('hex').slice(0, 16)
}

/** Build the toolchain without sending a workspace. */
export function imageContext() {
  const context = mkdtempSync(join(existsSync('/Volumes/AgentWork') ? '/Volumes/AgentWork' : tmpdir(), 'juno-remote-image-'))
  writeFileSync(join(context, 'toolchain.json'), JSON.stringify(toolchainVersions()))
  writeFileSync(join(context, 'Dockerfile'), readFileSync(join(root, 'scripts/remote/Dockerfile')))
  return context
}
