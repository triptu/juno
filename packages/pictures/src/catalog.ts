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
import { OLD_MASTERS } from './catalog/oldMasters.ts'
import { EUROPE_AND_AMERICA } from './catalog/europeAndAmerica.ts'
import { EAST_ASIA } from './catalog/eastAsia.ts'
import { SOUTH_ASIA } from './catalog/southAsia.ts'
import { ISLAMIC } from './catalog/islamic.ts'
import { NATURE } from './catalog/nature.ts'
import { SPACE } from './catalog/space.ts'

export const PICTURES: ReadonlyArray<Picture> = [...IMPRESSIONISTS, ...OLD_MASTERS, ...EUROPE_AND_AMERICA, ...EAST_ASIA, ...SOUTH_ASIA, ...ISLAMIC, ...NATURE, ...SPACE]
