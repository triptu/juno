#!/usr/bin/env bun
// Rebuilds the macOS app icon from assets/icon.svg.
//
//   bun scripts/build-icons.mjs
//
// Renders each iconset size straight from the SVG (not scaled down from the
// large one), then runs `iconutil` to make apps/desktop/build/icon.icns.
// Also writes apps/desktop/build/icon.png (1024px), which main uses as the
// Dock icon in development. macOS only: it needs `iconutil`. Rendering uses
// Google Chrome if installed, else Playwright's Chromium.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'assets/icon.svg')
const buildDir = join(root, 'apps/desktop/build')

// Iconset file name -> pixel size. @2x files are the next size up.
const iconset = {
  'icon_16x16.png': 16,
  'icon_16x16@2x.png': 32,
  'icon_32x32.png': 32,
  'icon_32x32@2x.png': 64,
  'icon_128x128.png': 128,
  'icon_128x128@2x.png': 256,
  'icon_256x256.png': 256,
  'icon_256x256@2x.png': 512,
  'icon_512x512.png': 512,
  'icon_512x512@2x.png': 1024,
}

// @playwright/test is a dev dependency of the desktop app, not the root.
const require = createRequire(join(root, 'apps/desktop/package.json'))
const { chromium } = require('@playwright/test')

async function launch() {
  try {
    return await chromium.launch({ channel: 'chrome' })
  } catch {
    return await chromium.launch()
  }
}

const svg = readFileSync(source, 'utf8')
const sizes = [...new Set(Object.values(iconset))]
const rendered = new Map()

const browser = await launch()
try {
  const page = await browser.newPage()
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size })
    // The SVG is inlined so no file: URL is needed. Its width and height are
    // overridden so the 1024 viewBox scales to the target size.
    const sized = svg.replace(' width="1024" height="1024"', ` width="${size}" height="${size}"`)
    await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${sized}</body>`)
    rendered.set(size, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }))
  }
} finally {
  await browser.close()
}

const work = mkdtempSync(join(tmpdir(), 'juno-icons-'))
try {
  const dir = join(work, 'icon.iconset')
  mkdirSync(dir)
  for (const [name, size] of Object.entries(iconset)) writeFileSync(join(dir, name), rendered.get(size))
  mkdirSync(buildDir, { recursive: true })
  execFileSync('iconutil', ['--convert', 'icns', '--output', join(buildDir, 'icon.icns'), dir])
  writeFileSync(join(buildDir, 'icon.png'), rendered.get(1024))
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`wrote ${join(buildDir, 'icon.icns')} and icon.png`)
