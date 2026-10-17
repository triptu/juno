/**
 * What a Change card calls a connection call (SPEC 13.3, 17): the action by
 * what it does ("Search Littlebird", "Create page in Notion") and a short verb
 * for its button ("Search", "Create page"). Made from the tool's name, then
 * its description's first word. Display only: whether a call reads, and its
 * tier and rule, never come from here (the auto-review, `catalogue.ts`, `policy/`).
 */

/**
 * The verb for a word in a tool's name. `alone`: the button is the verb alone ("Send").
 * `server`: the title names the connection as the object ("Search Littlebird").
 */
const VERBS: Readonly<Record<string, { readonly verb: string; readonly alone?: true; readonly server?: true }>> = {
  search: { verb: 'Search', alone: true, server: true }, query: { verb: 'Search', alone: true, server: true }, find: { verb: 'Find' },
  lookup: { verb: 'Look up' }, get: { verb: 'Get' }, fetch: { verb: 'Get' }, read: { verb: 'Read' },
  list: { verb: 'List' }, show: { verb: 'Show' }, describe: { verb: 'Describe' },
  create: { verb: 'Create' }, new: { verb: 'Create' }, add: { verb: 'Add' }, insert: { verb: 'Add' }, append: { verb: 'Add to' },
  update: { verb: 'Update' }, edit: { verb: 'Edit' }, patch: { verb: 'Update' }, set: { verb: 'Set' }, replace: { verb: 'Replace' },
  rename: { verb: 'Rename' }, move: { verb: 'Move' }, delete: { verb: 'Delete' }, remove: { verb: 'Remove' }, archive: { verb: 'Archive' },
  trash: { verb: 'Delete' }, send: { verb: 'Send', alone: true }, post: { verb: 'Post', alone: true }, publish: { verb: 'Publish', alone: true },
  reply: { verb: 'Reply', alone: true }, comment: { verb: 'Comment', alone: true }, upload: { verb: 'Upload' }, start: { verb: 'Start' },
  stop: { verb: 'Stop' }, run: { verb: 'Run', alone: true }, exec: { verb: 'Run', alone: true }, execute: { verb: 'Run', alone: true },
}

/** "notion-update-page", "createNote", "search_user_context" as lower-case words. */
const words = (text: string) => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

export interface ActionName {
  /** The card's title: "Create note in Notion", "Search Littlebird". */
  readonly title: string
  /** The button: "Create note", "Search", "Send", "Run". */
  readonly verb: string
}

/** The card's name for calling `tool` on `server` (the connection's label). */
export function actionName(server: string, tool: string, description: string | undefined): ActionName {
  const own = new Set(words(server))
  const named = words(tool).filter((word) => !own.has(word))
  const at = named.findIndex((word) => VERBS[word] !== undefined)
  const first = words(description ?? '')[0]
  const found = at >= 0 ? VERBS[named[at]!] : first !== undefined ? VERBS[first] : undefined
  const object = (at >= 0 ? named.filter((_, i) => i !== at) : named).join(' ')
  if (found === undefined) return { title: `Run ${tool} in ${server}`, verb: 'Run' }
  // Searching a connection is searching what it holds; the rest name their object.
  if (found.server) return { title: `${found.verb} ${server}`, verb: found.verb }
  const title = object !== '' ? `${found.verb} ${object} in ${server}` : found.verb === 'Run' ? `Run ${tool} in ${server}` : `${found.verb} in ${server}`
  const short = !found.alone && object !== '' && object.split(' ').length <= 2
  return { title, verb: short ? `${found.verb} ${object}` : found.verb }
}
