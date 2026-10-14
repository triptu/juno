/**
 * A fake server on pi-mcp's in-memory transport, for agent logic tests that
 * need no HTTP: no auth, no sockets. A lost answer is never delivered, so the
 * client's request times out.
 */
import { createInMemoryTransportPair } from '@earendil-works/pi-mcp/testing'
import type { McpTransport } from '@earendil-works/pi-mcp'
import type { McpHandler } from './handler'

/** A client transport connected to `handler`. Each call is a new connection. */
export function connectInMemory(handler: McpHandler): McpTransport {
  const { client, server } = createInMemoryTransportPair()
  const unsubscribe = handler.subscribe((message) => void server.send(message).catch(() => {}))
  server.onMessage(async (message) => {
    const answer = await handler.answer(message)
    if (answer.kind === 'reply') await server.send(answer.message).catch(() => {})
  })
  server.onClose(unsubscribe)
  void server.start()
  return client
}
