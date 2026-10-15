import type { McpManagerApi } from '../mcp/manager'

/** Names and schemas come from tools/list. Only reviewed hashes authorize reads. */
export function littlebirdCatalogue(manager: McpManagerApi) {
  return manager.definitions('littlebird').map((tool) => ({
    name: tool.name, schemaHash: tool.hash, definition: tool.definition,
    // A read runs at once; anything else goes through the auto-review and may become a card.
    access: tool.tier === 0 ? 'read' : 'reviewed',
  }))
}
