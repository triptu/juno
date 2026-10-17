/**
 * The fake MCP servers alone, for the desktop e2e. Playwright loads specs as
 * CommonJS and pi-mcp has only an ESM entry, so a spec imports this with a
 * dynamic `import()`; it shares no module with `./openrouter`.
 */
export { startFakeLittlebird, unknownTool, type FakeLittlebird } from './littlebird'
export { startFakeNotion, type FakeNotion } from './notion'
export { startFakeMcpServer, type FakeMcpServer } from './server'
export { json, type FakeTool } from './handler'
