const { build } = require('electron-builder')
const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

// Updates come from GitHub Releases of a private repository, read with a
// fine-grained token that can only read it (docs/development.md, "Releasing").
// The token is written into the app's update.json at package time and never
// printed or committed. Without it the app is built with updates unavailable.
const repository = process.env.JUNO_UPDATE_REPOSITORY || 'triptu/juno-releases'
const updateToken = process.env.JUNO_UPDATE_TOKEN
if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('JUNO_UPDATE_REPOSITORY must be owner/repo')
if (updateToken && !/^github_pat_\w+$/.test(updateToken)) {
  // A classic token cannot be limited to one repository, so it must never ship.
  throw new Error('JUNO_UPDATE_TOKEN must be a fine-grained personal access token')
}
const [owner, repo] = repository.split('/')
const release = process.env.JUNO_RELEASE === '1'
const appleId = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
const apiKey = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
const complete = (names) => names.every((name) => Boolean(process.env[name]))
const useAppleId = Boolean(process.env.APPLE_ID || process.env.APPLE_APP_SPECIFIC_PASSWORD)
const useApiKey = apiKey.some((name) => Boolean(process.env[name]))
if (release && (useAppleId === useApiKey || !complete(useAppleId ? appleId : apiKey))) {
  throw new Error('Releasing requires exactly one complete Apple ID or App Store Connect API credential set')
}
if (release && !process.env.CSC_LINK && !process.env.CSC_NAME) {
  throw new Error('Releasing requires CSC_LINK or CSC_NAME for a Developer ID Application identity')
}
if (release && process.env.CSC_LINK && !process.env.CSC_KEY_PASSWORD) {
  throw new Error('CSC_LINK requires the certificate export password in CSC_KEY_PASSWORD')
}
if (!release) console.log('Packaging unsigned; Developer ID signing and notarization are off (JUNO_RELEASE is unset).')
if (!release) process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
if (!updateToken) console.log('Packaging without updates; JUNO_UPDATE_TOKEN is unset.')

// Never let a previous package's assets enter the next release.
const output = resolve(__dirname, '../release')
const version = require('../package.json').version
for (const name of (existsSync(output) ? readdirSync(output, { withFileTypes: true }) : []).filter((entry) => entry.isFile()).map((entry) => entry.name)) {
  if (name === 'latest-mac.yml' || name.includes(`-${version}-`) || name.includes(`-${version}.`)) rmSync(join(output, name), { force: true })
}

// The workspace links dependencies from pnpm's global virtual store, where
// electron-builder cannot find the dependencies of a dependency. Package from
// `pnpm deploy` instead: the built app and its production dependencies as
// real files in a temporary folder. Native rebuilds then touch only this copy.
// The folder is on the AgentWork volume when it is mounted, so writing and
// deleting the copy does not load fseventsd (scripts/worktree-folder.mjs).
async function main() {
  const { scratchFolder } = await import('../../../scripts/worktree-folder.mjs')
  const { recordReleaseTiming } = await import('../../../scripts/release-timings.mjs')
  mkdirSync(scratchFolder(), { recursive: true })
  const staging = mkdtempSync(join(scratchFolder(), 'juno-deploy-'))
  const app = join(staging, 'app')
  try {
    const deployStarted = Date.now()
    execFileSync('pnpm', ['--filter', '@juno/desktop', 'deploy', '--prod', app], { cwd: resolve(__dirname, '..'), stdio: 'inherit' })
    recordReleaseTiming('deploy', deployStarted)
    // Read by main (src/main/releaseFeed.ts). `signed` says whether Squirrel.Mac can install in place.
    if (updateToken) writeFileSync(join(app, 'update.json'), JSON.stringify({ repository, token: updateToken, signed: release }), { mode: 0o600 })
    const builderStarted = Date.now()
    let artifactStarted = builderStarted
    await build({
      config: {
        extends: './electron-builder.yml',
        directories: { app, output: 'release', buildResources: 'build' },
        forceCodeSigning: release,
        // Writes latest-mac.yml for `pnpm release:publish`. Nothing is uploaded here.
        publish: { provider: 'github', owner, repo, private: true },
        mac: { notarize: release, target: release ? ['dmg', 'zip'] : ['dmg'], ...(!release ? { identity: null } : {}) },
        afterPack: async () => { artifactStarted = Date.now() },
        afterSign: async () => {
          if (release) recordReleaseTiming('notarize', artifactStarted, { status: 'completed with signing' })
          artifactStarted = Date.now()
        },
        afterAllArtifactBuild: async () => { recordReleaseTiming('DMG', artifactStarted) },
        // ARM64 macOS requires a valid local signature after the fuse bytes change.
        electronFuses: { resetAdHocDarwinSignature: !release },
      },
      publish: 'never',
    })
    if (!release) recordReleaseTiming('notarize', Date.now(), { status: 'skipped' })
    recordReleaseTiming('electron-builder', builderStarted)
  } catch {
    console.error('Packaging failed; see electron-builder output above.')
    process.exitCode = 1
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

void main()
