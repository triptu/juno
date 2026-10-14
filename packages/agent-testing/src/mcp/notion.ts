/**
 * Fake Notion MCP (plan v3 §10.2): OAuth with PKCE, dynamic registration and
 * rotating refresh tokens, and a small page store. Tool names follow Notion's
 * hosted server (`notion-search`, `notion-fetch` read; `notion-create-pages`,
 * `notion-update-page` write); their arguments are simplified.
 *
 * What it lets a test do:
 * - expire tokens (`oauth.expireAccessTokens()`): the next request gets 401
 *   `invalid_token`, and pi-mcp refreshes;
 * - lose a write (`loseNextWrite()`): the page changes but the answer never
 *   arrives, so only a read back can tell;
 * - edit a page from elsewhere (`editElsewhere()`): its `last_edited_time`
 *   moves, so a stored precondition no longer matches.
 */
import { json, type FakeTool } from './handler'
import { startFakeMcpServer, type FakeMcpServer } from './server'

export interface NotionPage {
  readonly id: string
  readonly title: string
  readonly content: string
  /** ISO 8601, minute precision, as Notion reports it. */
  readonly last_edited_time: string
}

export interface FakeNotionOptions {
  readonly pages?: ReadonlyArray<Pick<NotionPage, 'id' | 'title' | 'content'>>
  readonly accessTokenSeconds?: number
}

export interface FakeNotion extends FakeMcpServer {
  readonly oauth: NonNullable<FakeMcpServer['oauth']>
  readonly pages: () => ReadonlyArray<NotionPage>
  /** Another Notion client edits the page: new content and a later `last_edited_time`. */
  readonly editElsewhere: (id: string, content: string) => NotionPage
  /** The next write is lost. With `applied` (the default) Notion made the change first. */
  readonly loseNextWrite: (options?: { readonly tool?: 'notion-update-page' | 'notion-create-pages'; readonly applied?: boolean }) => void
}

export const NOTION_READ_TOOLS = ['notion-search', 'notion-fetch'] as const
export const NOTION_WRITE_TOOLS = ['notion-create-pages', 'notion-update-page'] as const

const examplePages = [
  { id: 'page-roadmap', title: 'Roadmap', content: 'Q4: ship the topic view.' },
  { id: 'page-notes', title: 'Meeting notes', content: 'Decided to move the launch to Tuesday.' },
]

export async function startFakeNotion(options: FakeNotionOptions = {}): Promise<FakeNotion> {
  // Notion's clock starts at a fixed minute and moves one minute per edit, so tests are exact.
  let minute = 0
  const stamp = () => new Date(Date.UTC(2026, 9, 14, 9, minute++)).toISOString()
  const store = new Map<string, NotionPage>()
  for (const page of options.pages ?? examplePages) store.set(page.id, { ...page, last_edited_time: stamp() })
  let created = 0
  const find = (id: unknown) => {
    const page = store.get(String(id))
    if (!page) throw new Error(`Could not find page with ID: ${String(id)}. Make sure the page exists and is shared with the integration.`)
    return page
  }
  const edit = (page: NotionPage, content: string) => {
    const next = { ...page, content, last_edited_time: stamp() }
    store.set(page.id, next)
    return next
  }
  const view = (page: NotionPage) => ({ ...page, url: `https://www.notion.so/${page.id}` })
  const text = { type: 'string' } as const

  const tools: FakeTool[] = [
    {
      name: 'notion-search',
      description: 'Search pages in the Notion workspace.',
      inputSchema: { type: 'object', properties: { query: text }, required: ['query'] },
      annotations: { readOnlyHint: true },
      call: ({ query }) => {
        const q = String(query).toLowerCase()
        const results = [...store.values()].filter((p) => `${p.title}\n${p.content}`.toLowerCase().includes(q))
          .map(({ id, title, last_edited_time }) => ({ id, title, last_edited_time, url: `https://www.notion.so/${id}` }))
        return json({ results })
      },
    },
    {
      name: 'notion-fetch',
      description: 'Fetch a page by ID.',
      inputSchema: { type: 'object', properties: { id: text }, required: ['id'] },
      annotations: { readOnlyHint: true },
      call: ({ id }) => json(view(find(id))),
    },
    {
      name: 'notion-create-pages',
      description: 'Create pages.',
      inputSchema: { type: 'object', properties: { pages: { type: 'array', items: { type: 'object', properties: { title: text, content: text } } } }, required: ['pages'] },
      call: ({ pages }) => {
        const made = (pages as Array<{ title?: string; content?: string }>).map((p) => {
          const page = { id: `page-new-${++created}`, title: p.title ?? 'Untitled', content: p.content ?? '', last_edited_time: stamp() }
          store.set(page.id, page)
          return { id: page.id, url: `https://www.notion.so/${page.id}` }
        })
        return json({ pages: made })
      },
    },
    {
      name: 'notion-update-page',
      description: 'Replace or append to the content of a page.',
      inputSchema: {
        type: 'object',
        properties: { page_id: text, command: { type: 'string', enum: ['replace_content', 'append_content'] }, content: text },
        required: ['page_id', 'command', 'content'],
      },
      call: ({ page_id, command, content }) => {
        const page = find(page_id)
        return json(view(edit(page, command === 'append_content' ? `${page.content}\n${String(content)}` : String(content))))
      },
    },
    {
      name: 'notion-get-self',
      description: 'The bot user and workspace of this connection.',
      annotations: { readOnlyHint: true },
      call: () => json({ type: 'bot', workspace_name: 'Example workspace', owner: { type: 'user', name: 'Test Owner' } }),
    },
  ]

  const server = await startFakeMcpServer({
    name: 'Notion MCP (fake)',
    tools,
    oauth: { scopes: [], refresh: true, ...(options.accessTokenSeconds ? { accessTokenSeconds: options.accessTokenSeconds } : {}) },
  })
  return {
    ...server,
    oauth: server.oauth!,
    pages: () => [...store.values()],
    editElsewhere: (id, content) => edit(find(id), content),
    loseNextWrite: (lost = {}) => server.loseNextCall(lost.tool ?? 'notion-update-page', { applied: lost.applied ?? true }),
  }
}
