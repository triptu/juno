/**
 * The tour's screenshots (SPEC 4, "The tour"). `pnpm tour:shots` runs this
 * against the built gallery: it opens each `TourScene` state in light and
 * dark, shoots the scene at 2x into
 * `packages/views/src/tour/shots/<step>-<theme>.webp`, and measures the
 * boxes the scene's callouts point at (its `data-tour-anchors`). Then it
 * writes `manifest.ts`, which the tour sheet imports: the image URLs and
 * each anchor's box as fractions of the picture.
 *
 * Run it after a change that alters what a scene shows, and commit what it
 * writes. It fails when an anchor finds nothing or lands in a different
 * place in the two themes.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openState, readRoutes, type Theme } from './support'

const outDir = join(import.meta.dirname, '../../packages/views/src/tour/shots')
const themes: ReadonlyArray<Theme> = ['light', 'dark']
const SCENE = { width: 720, height: 480 }
/** Room left around what a callout marks, in CSS pixels, so its ring does not sit on the edge. */
const PAD = 2
/** A mark keeps this far inside the picture, so its number, which sits on its corner, is never cut. */
const EDGE = 10
/** Lossy WebP at this quality keeps UI text sharp at a quarter of the PNG's size. */
const QUALITY = 0.92

type Box = readonly [number, number, number, number]

/** The PNG Playwright took, as WebP: Chromium encodes it on a canvas. */
async function toWebp(page: Page, png: Buffer): Promise<Buffer> {
  const data = await page.evaluate(
    async ({ base64, quality }) => {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext('2d')?.drawImage(image, 0, 0)
      return canvas.toDataURL('image/webp', quality).split(',')[1] ?? ''
    },
    { base64: png.toString('base64'), quality: QUALITY },
  )
  return Buffer.from(data, 'base64')
}

const round = (value: number) => Math.round(value * 10_000) / 10_000

test('shoots the tour scenes in light and dark', async ({ page }) => {
  test.setTimeout(5 * 60_000)
  const routes = (await readRoutes(page)).filter((route) => route.component === 'TourScene')
  expect(routes.length).toBe(5)
  await mkdir(outDir, { recursive: true })

  const manifest = new Map<string, Record<string, Box>>()
  for (const route of routes) {
    for (const theme of themes) {
      await openState(page, route, theme)
      await page.mouse.move(0, 0)
      const scene = page.locator(`[data-fixture-frame="${route.route}"] [data-tour-scene]`)
      const step = await scene.getAttribute('data-tour-scene')
      const anchors = JSON.parse((await scene.getAttribute('data-tour-anchors')) ?? '{}') as Record<string, string>
      const frame = await scene.boundingBox()
      if (step === null || frame === null) throw new Error(`No scene in ${route.route}`)
      expect(Math.round(frame.width)).toBe(SCENE.width)
      expect(Math.round(frame.height)).toBe(SCENE.height)

      const boxes: Record<string, Box> = {}
      for (const [name, selector] of Object.entries(anchors)) {
        const target = scene.locator(selector).first()
        await expect(target, `${step}: the "${name}" anchor (${selector})`).toBeVisible()
        const box = await target.boundingBox()
        if (box === null) throw new Error(`${step}: the "${name}" anchor has no box`)
        const inside = box.x >= frame.x - 1 && box.y >= frame.y - 1 && box.x + box.width <= frame.x + SCENE.width + 1 && box.y + box.height <= frame.y + SCENE.height + 1
        if (!inside) throw new Error(`${step}: the "${name}" anchor is outside the picture`)
        // Not under something else either, such as the composer over the end of a list.
        const onTop = await target.evaluate((element, at) => {
          const hit = document.elementFromPoint(at.x, at.y)
          return hit !== null && (element === hit || element.contains(hit))
        }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
        if (!onTop) throw new Error(`${step}: the "${name}" anchor is covered`)
        const left = Math.max(EDGE, box.x - frame.x - PAD)
        const top = Math.max(EDGE, box.y - frame.y - PAD)
        const right = Math.min(SCENE.width - PAD, box.x - frame.x + box.width + PAD)
        const bottom = Math.min(SCENE.height - PAD, box.y - frame.y + box.height + PAD)
        boxes[name] = [round(left / SCENE.width), round(top / SCENE.height), round((right - left) / SCENE.width), round((bottom - top) / SCENE.height)]
      }
      const known = manifest.get(step)
      if (known === undefined) manifest.set(step, boxes)
      else expect(boxes, `${step}: the anchors are where they were in light`).toEqual(known)

      const png = await scene.screenshot({ animations: 'disabled', caret: 'hide' })
      await writeFile(join(outDir, `${step}-${theme}.webp`), await toWebp(page, png))
    }
  }

  const lines = [...manifest].map(([step, boxes]) => {
    const anchors = Object.entries(boxes).map(([name, box]) => `      '${name}': [${box.join(', ')}],`)
    return [
      `  '${step}': {`,
      `    light: new URL('./${step}-light.webp', import.meta.url).href,`,
      `    dark: new URL('./${step}-dark.webp', import.meta.url).href,`,
      `    width: ${SCENE.width},`,
      `    height: ${SCENE.height},`,
      '    anchors: {',
      ...anchors,
      '    },',
      '  },',
    ].join('\n')
  })
  const source = `// Written by \`pnpm tour:shots\` (apps/gallery/tour-shots.ts). Do not edit by hand.
import type { TourStepId } from '../copy'

/** One step's screenshot: a file per theme, and each callout's box as fractions of the picture (x, y, width, height). */
export interface TourShot {
  readonly light: string
  readonly dark: string
  readonly width: number
  readonly height: number
  readonly anchors: Readonly<Record<string, readonly [number, number, number, number]>>
}

export const tourShots: Readonly<Record<TourStepId, TourShot>> = {
${lines.join('\n')}
}
`
  await writeFile(join(outDir, 'manifest.ts'), source)
})
