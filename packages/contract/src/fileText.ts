/**
 * The media viewer's text items (SPEC section 8, "Other files"): a Markdown
 * file as a body and a CSV file as rows, `@juno/domain` rules the renderer
 * runs on a file it fetched, reached here because the renderer does not
 * import domain (as with `composer.ts`).
 */
export { bodyFromMarkdown, csvRows } from '@juno/domain'
