/**
 * Home's pictures and their stories (SPEC 12, "A picture" and "Pictures and
 * the gallery"), one file per area. Its own chunk: loaded when idle after Home
 * paints and when the gallery opens. Every artwork is public domain or CC0;
 * NASA images are public domain. Every fact names the source that states it;
 * leave a fact out when in doubt. `ratio` is the image files' width over height
 * (scripts/pictures/build.mjs checks it).
 */
import type { Picture } from './index'
import { IMPRESSIONISTS } from './catalog/impressionists.ts'
import { EUROPE } from './catalog/europe.ts'
import { ASIA } from './catalog/asia.ts'
import { ISLAMIC_AND_NATURE } from './catalog/islamicAndNature.ts'
import { SPACE } from './catalog/space.ts'

export const PICTURES: ReadonlyArray<Picture> = [...IMPRESSIONISTS, ...EUROPE, ...ASIA, ...ISLAMIC_AND_NATURE, ...SPACE]
