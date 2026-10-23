/**
 * Fake Littlebird MCP (plan v3 §10.2): OAuth with the scopes S8 found
 * (`littlebird:mcp openid email`) and refresh, and a tool list that changes
 * while connected. `tools/list` is paginated (three per page by default), so
 * discovery must follow the cursor.
 *
 * Littlebird's real tool names were not read (S8 stopped before sign-in), so
 * the names here are invented to match the plan's description: reads for
 * meetings, context search, routine reports and the account; writes for
 * adding material, deleting it, and creating or updating routines. The reads
 * mark themselves read-only, as an MCP server should; the writes do not.
 * `unknownTool()` makes a tool no read list has heard of.
 */
import { json, type FakeTool } from './handler'
import { startFakeMcpServer, type FakeMcpServer } from './server'

export interface FakeLittlebirdOptions {
  /** More tools, listed after the known ones (for example `unknownTool()`). */
  readonly extraTools?: ReadonlyArray<FakeTool>
  readonly pageSize?: number
}

export interface FakeLittlebird extends FakeMcpServer {
  readonly oauth: NonNullable<FakeMcpServer['oauth']>
  /** Adds a tool and sends `list_changed`. */
  readonly addTool: (tool: FakeTool) => void
  /** Removes a tool and sends `list_changed`. */
  readonly removeTool: (name: string) => void
  /** Gives a tool a new input schema (so its schema hash changes) and sends `list_changed`. */
  readonly changeSchema: (name: string, inputSchema: NonNullable<FakeTool['inputSchema']>) => void
  /** Materials added through `add_material`. */
  readonly materials: () => ReadonlyArray<{ readonly title: string; readonly text: string }>
}

/**
 * A tool on no read list that claims to be read-only. Juno takes the claim as
 * a read only as the server made it when Juno first saw the tool, and only
 * while its schema is unchanged (SPEC 13.9).
 */
export const unknownTool = (name = 'export_everything'): FakeTool => ({
  name,
  description: 'Export all workspace data.',
  inputSchema: { type: 'object', properties: { format: { type: 'string' } } },
  annotations: { readOnlyHint: true },
  call: () => json({ exported: 0 }),
})

export async function startFakeLittlebird(options: FakeLittlebirdOptions = {}): Promise<FakeLittlebird> {
  const materials: Array<{ title: string; text: string }> = []
  const routines = new Map<string, { id: string; name: string; prompt: string }>()
  const query = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } as const
  const byId = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } as const
  const meetings = [
    { id: 'meeting-1', title: 'Design review', date: '2026-10-13', summary: 'Agreed on the calmer sidebar.' },
    { id: 'meeting-2', title: 'Planning', date: '2026-10-14', summary: 'Moved the launch to Tuesday.' },
  ]
  const known: FakeTool[] = [
    { name: 'search_meetings', annotations: { readOnlyHint: true }, inputSchema: query, call: ({ query: q }) => json({ meetings: meetings.filter((m) => `${m.title} ${m.summary}`.toLowerCase().includes(String(q).toLowerCase())) }) },
    { name: 'get_meeting', annotations: { readOnlyHint: true }, inputSchema: byId, call: ({ id }) => {
      const meeting = meetings.find((m) => m.id === id)
      if (!meeting) throw new Error(`No meeting ${String(id)}`)
      return json(meeting)
    } },
    { name: 'search_context', annotations: { readOnlyHint: true }, inputSchema: query, call: ({ query: q }) => json({ results: materials.filter((m) => m.text.includes(String(q))) }) },
    { name: 'get_routine_report', annotations: { readOnlyHint: true }, inputSchema: byId, call: ({ id }) => json({ id, report: `No new items for ${String(id)}.` }) },
    { name: 'get_account', annotations: { readOnlyHint: true }, call: () => json({ name: 'Test Owner', plan: 'free' }) },
    { name: 'add_material', inputSchema: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'] },
      call: ({ title, text }) => {
        materials.push({ title: String(title), text: String(text) })
        return json({ id: `material-${materials.length}` })
      } },
    { name: 'delete_material', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      call: ({ title }) => {
        const index = materials.findIndex((m) => m.title === title)
        if (index >= 0) materials.splice(index, 1)
        return json({ deleted: index >= 0 })
      } },
    { name: 'create_routine', inputSchema: { type: 'object', properties: { name: { type: 'string' }, prompt: { type: 'string' } }, required: ['name', 'prompt'] },
      call: ({ name, prompt }) => {
        const routine = { id: `routine-${routines.size + 1}`, name: String(name), prompt: String(prompt) }
        routines.set(routine.id, routine)
        return json(routine)
      } },
    { name: 'update_routine', inputSchema: { type: 'object', properties: { id: { type: 'string' }, prompt: { type: 'string' } }, required: ['id', 'prompt'] },
      call: ({ id, prompt }) => {
        const routine = routines.get(String(id))
        if (!routine) throw new Error(`No routine ${String(id)}`)
        const next = { ...routine, prompt: String(prompt) }
        routines.set(next.id, next)
        return json(next)
      } },
  ]
  const server = await startFakeMcpServer({
    name: 'Littlebird (fake)',
    tools: [...known, ...(options.extraTools ?? [])],
    pageSize: options.pageSize ?? 3,
    oauth: { scopes: ['littlebird:mcp', 'openid', 'email'], refresh: true },
  })
  return {
    ...server,
    oauth: server.oauth!,
    addTool: (tool) => server.setTools([...server.tools(), tool]),
    removeTool: (name) => server.setTools(server.tools().filter((tool) => tool.name !== name)),
    changeSchema: (name, inputSchema) => server.setTools(server.tools().map((tool) => (tool.name === name ? { ...tool, inputSchema } : tool))),
    materials: () => materials,
  }
}
