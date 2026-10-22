import { chunk } from './chunks'

/**
 * The gallery and the picture page (SPEC 12, "Pictures and the gallery"):
 * loaded when a gallery tab first shows, or when idle while Home shows a
 * picture, so opening that picture's page never draws an empty page first.
 */
export const gallery = chunk(() => import('./Gallery'))
