import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

// The gallery screenshot runner on a private port, so another checkout's
// gallery on 4174 is never screenshotted by mistake (review harness only).
const port = 4199
const gallery = resolve(__dirname, '../../../../apps/gallery')

export default defineConfig({
  testDir: gallery,
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    channel: 'chrome',
    viewport: { width: 1800, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'shots', testMatch: 'shots.spec.ts' }],
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    cwd: gallery,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
