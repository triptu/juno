/**
 * Home's pictures and their words (SPEC 12, "A picture" and "Pictures and
 * the gallery"), one file per area. Its own chunk: loaded when idle after Home
 * paints and when the gallery opens. Every artwork is public domain or CC0;
 * NASA images are public domain. Every line names the source that states it;
 * leave it out when in doubt. `ratio` is the image files' width over height
 * (scripts/pictures/build.mjs checks it).
 *
 * Interim: each entry's line, about and learnMore were converted mechanically
 * from its old list of facts (the first short sentence became the line, the
 * rest the about, and the first museum or NASA page the link). The edited
 * words replace them.
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
