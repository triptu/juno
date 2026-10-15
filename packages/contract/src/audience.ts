/**
 * The audience check (spec section 8): a `@juno/domain` rule the composer
 * runs as the user types, reached here because the renderer does not
 * import domain (as with `menus.ts`).
 */
export { audienceCheck } from '@juno/domain'
