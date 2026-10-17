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
 * `ing`: the status bubble's form ("Creating a page in Notion"), with `from` when the
 * thing comes out of the connection. A verb with no `ing` reads "Checking with Notion".
 */
interface Verb {
  readonly verb: string
  readonly ing?: string
  readonly alone?: true
  readonly server?: true
  readonly from?: true
}

const VERBS: Readonly<Record<string, Verb>> = {
  search: { verb: 'Search', ing: 'Searching', alone: true, server: true }, query: { verb: 'Search', ing: 'Searching', alone: true, server: true },
  find: { verb: 'Find', ing: 'Finding', from: true }, lookup: { verb: 'Look up', ing: 'Looking up', from: true },
  get: { verb: 'Get', ing: 'Getting', from: true }, fetch: { verb: 'Get', ing: 'Getting', from: true }, read: { verb: 'Read', ing: 'Reading', from: true },
  list: { verb: 'List', ing: 'Listing', from: true }, show: { verb: 'Show' }, describe: { verb: 'Describe' },
  create: { verb: 'Create', ing: 'Creating' }, new: { verb: 'Create', ing: 'Creating' }, add: { verb: 'Add', ing: 'Adding' },
  insert: { verb: 'Add', ing: 'Adding' }, append: { verb: 'Add to', ing: 'Adding to' },
  update: { verb: 'Update', ing: 'Updating' }, edit: { verb: 'Edit', ing: 'Editing' }, patch: { verb: 'Update', ing: 'Updating' },
  set: { verb: 'Set', ing: 'Setting' }, replace: { verb: 'Replace', ing: 'Replacing' }, rename: { verb: 'Rename', ing: 'Renaming' },
  move: { verb: 'Move', ing: 'Moving' }, delete: { verb: 'Delete', ing: 'Deleting' }, remove: { verb: 'Remove', ing: 'Removing' },
  archive: { verb: 'Archive', ing: 'Archiving' }, trash: { verb: 'Delete', ing: 'Deleting' },
  send: { verb: 'Send', ing: 'Sending', alone: true }, post: { verb: 'Post', ing: 'Posting', alone: true },
  publish: { verb: 'Publish', ing: 'Publishing', alone: true }, reply: { verb: 'Reply', ing: 'Replying', alone: true },
  comment: { verb: 'Comment', ing: 'Commenting', alone: true }, upload: { verb: 'Upload', ing: 'Uploading' },
  start: { verb: 'Start', ing: 'Starting' }, stop: { verb: 'Stop', ing: 'Stopping' },
  run: { verb: 'Run', ing: 'Running', alone: true }, exec: { verb: 'Run', ing: 'Running', alone: true }, execute: { verb: 'Run', ing: 'Running', alone: true },
}

/** "notion-update-page", "createNote", "search_user_context" as lower-case words. */
const words = (text: string) => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** The tool's verb, from its name, else its description's first word, and the rest of its name without the server's. */
function parse(server: string, tool: string, description: string | undefined): { readonly found: Verb | undefined; readonly object: string } {
  const own = new Set(words(server))
  const named = words(tool).filter((word) => !own.has(word))
  const at = named.findIndex((word) => VERBS[word] !== undefined)
  const first = words(description ?? '')[0]
  const found = at >= 0 ? VERBS[named[at]!] : first !== undefined ? VERBS[first] : undefined
  return { found, object: (at >= 0 ? named.filter((_, i) => i !== at) : named).join(' ') }
}

export interface ActionName {
  /** The card's title: "Create note in Notion", "Search Littlebird". */
  readonly title: string
  /** The button: "Create note", "Search", "Send", "Run". */
  readonly verb: string
}

/** The card's name for calling `tool` on `server` (the connection's label). */
export function actionName(server: string, tool: string, description: string | undefined): ActionName {
  const { found, object } = parse(server, tool, description)
  if (found === undefined) return { title: `Run ${tool} in ${server}`, verb: 'Run' }
  // Searching a connection is searching what it holds; the rest name their object.
  if (found.server) return { title: `${found.verb} ${server}`, verb: found.verb }
  const title = object !== '' ? `${found.verb} ${object} in ${server}` : found.verb === 'Run' ? `Run ${tool} in ${server}` : `${found.verb} in ${server}`
  const short = !found.alone && object !== '' && object.split(' ').length <= 2
  return { title, verb: short ? `${found.verb} ${object}` : found.verb }
}

/** "a page", "an item", and a plural as it is. */
const counted = (object: string) => {
  const head = object.split(' ')[0] ?? ''
  if (head.endsWith('s') && !head.endsWith('ss')) return object
  return `${/^[aeiou]/.test(object) ? 'an' : 'a'} ${object}`
}

/**
 * The status bubble's line while Juno calls `tool` on `server` (SPEC 13.2): "Searching Notion",
 * "Creating a page in Notion", "Getting a meeting from Littlebird", and "Checking with
 * Littlebird" when the tool's name gives no clear verb.
 */
export function actionStatus(server: string, tool: string, description: string | undefined): string {
  const { found, object } = parse(server, tool, description)
  if (found?.ing === undefined) return `Checking with ${server}`
  if (found.server) return `${found.ing} ${server}`
  if (object === '') return found.verb === 'Run' ? `Running a command in ${server}` : `${found.ing} in ${server}`
  return `${found.ing} ${counted(object)} ${found.from ? 'from' : 'in'} ${server}`
}
