/**
 * The audience check, and which messages the checks on send read (spec
 * section 8): `@juno/domain` rules the composer runs, reached here because the renderer does not
 * import domain (as with `menus.ts`).
 */
export { audienceCheck, sendChecksApply } from '@juno/domain'
