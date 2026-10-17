const { build } = require('electron-builder')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const feed = process.env.JUNO_UPDATE_FEED_URL
if (feed) {
  const url = new URL(feed)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('JUNO_UPDATE_FEED_URL must be a public HTTPS base URL without credentials, query or fragment')
  }
}
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

// A previous build may have enabled updates; never leave its checksums behind.
rmSync(resolve(__dirname, '../release/latest-mac.yml'), { force: true })

// The workspace links dependencies from pnpm's global virtual store, where
// electron-builder cannot find the dependencies of a dependency. Package from
// `pnpm deploy` instead: the built app and its production dependencies as
// real files in a temporary folder. Native rebuilds then touch only this copy.
const staging = mkdtempSync(join(tmpdir(), 'juno-deploy-'))
const app = join(staging, 'app')
execFileSync('pnpm', ['--filter', '@juno/desktop', 'deploy', '--prod', app], { cwd: resolve(__dirname, '..'), stdio: 'inherit' })

build({
  config: {
    extends: './electron-builder.yml',
    directories: { app, output: 'release', buildResources: 'build' },
    forceCodeSigning: release,
    publish: feed ? { provider: 'generic', url: feed } : null,
    mac: { notarize: release, ...(!release ? { identity: null } : {}) },
    // ARM64 macOS requires a valid local signature after the fuse bytes change.
    electronFuses: { resetAdHocDarwinSignature: !release },
  },
  publish: 'never',
})
  .catch(() => {
    console.error('Packaging failed; see electron-builder output above.')
    process.exitCode = 1
  })
  .finally(() => rmSync(staging, { recursive: true, force: true }))
