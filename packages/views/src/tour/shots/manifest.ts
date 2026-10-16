// Written by `pnpm tour:shots` (apps/gallery/tour-shots.ts). Do not edit by hand.
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
  'topics': {
    light: new URL('./topics-light.webp', import.meta.url).href,
    dark: new URL('./topics-dark.webp', import.meta.url).href,
    width: 720,
    height: 480,
    anchors: {
      'thread': [0.0139, 0.4313, 0.4181, 0.1917],
      'main': [0.0139, 0.6188, 0.4181, 0.1417],
    },
  },
  'dm-twice': {
    light: new URL('./dm-twice-light.webp', import.meta.url).href,
    dark: new URL('./dm-twice-dark.webp', import.meta.url).href,
    width: 720,
    height: 480,
    anchors: {
      'main': [0.0139, 0.4313, 0.4181, 0.1417],
      'thread': [0.0139, 0.5688, 0.4181, 0.1917],
      'link': [0.5611, 0.44, 0.3833, 0.0625],
    },
  },
  'around': {
    light: new URL('./around-light.webp', import.meta.url).href,
    dark: new URL('./around-dark.webp', import.meta.url).href,
    width: 720,
    height: 480,
    anchors: {
      'nav': [0.0139, 0.0875, 0.4319, 0.225],
      'search': [0.2903, 0.0208, 0.0472, 0.0604],
      'peek': [0.4528, 0.0875, 0.5389, 0.8063],
    },
  },
  'yours': {
    light: new URL('./yours-light.webp', import.meta.url).href,
    dark: new URL('./yours-dark.webp', import.meta.url).href,
    width: 720,
    height: 480,
    anchors: {
      'automated': [0.1492, 0.3521, 0.0444, 0.0667],
      'new-view': [0.3403, 0.3521, 0.0444, 0.0667],
      'settings': [0.3847, 0.0208, 0.0472, 0.0604],
    },
  },
  'juno': {
    light: new URL('./juno-light.webp', import.meta.url).href,
    dark: new URL('./juno-dark.webp', import.meta.url).href,
    width: 720,
    height: 480,
    anchors: {
      'nav': [0.0139, 0.2375, 0.4181, 0.075],
      'send': [0.747, 0.7555, 0.085, 0.0708],
    },
  },
}
