import type { McpManagerApi } from '../mcp/manager'

/** Names and schemas come from tools/list. Only reviewed hashes authorize reads. */
export function littlebirdCatalogue(manager: McpManagerApi) {
  return manager.definitions('littlebird').map((tool) => ({
    name: tool.name, schemaHash: tool.hash, definition: tool.definition,
    access: tool.tier === 0 ? 'read' : 'card',
  }))
}
