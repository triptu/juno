/**
 * @juno/slack: the Slack client as Effect services.
 *
 * Compose with `SlackClient.layer` and provide the three seams the host
 * owns: `SlackSession` (ids and token), `HttpTransport` (`NodeFetch` here,
 * `ElectronNet` in the app) and `SocketHandshake` (cookie, origin, user
 * agent and proxy for the socket upgrade). `SlackConfig` has defaults and
 * is overridden with `slackConfigLayer`.
 *
 * Payload schemas and the `Ts` helpers live in `@juno/slack-schema`.
 */
import { Layer } from 'effect'
import { SlackApi } from './client/api.ts'
import { SlackEdge } from './client/edge.ts'
import { RequestQueue } from './client/queue.ts'
import { SlackSession } from './client/session.ts'
import { SlackSocket, SocketHandshake } from './client/socket.ts'
import { HttpTransport } from './client/transport.ts'

export { SlackApi, type SlackApiShape } from './client/api.ts'
export { scaledPacing, slackConfigLayer, type SlackConfigOverrides } from './client/config.ts'
export { SlackEdge } from './client/edge.ts'
export { SlackAuthRequired, SlackDecodeError, SlackRejected, type SlackApiError } from './client/errors.ts'
export { searchMessages } from './client/search.ts'
export { RequestQueue } from './client/queue.ts'
export { apiBaseFromWorkspace, SlackSession, slackRoute, type SlackSessionShape } from './client/session.ts'
export { SlackSocket, SocketHandshake, type SocketEvent, type SocketHandshakeShape } from './client/socket.ts'
export { HttpTransport, HttpTransportError, type HttpResponse } from './client/transport.ts'

/** Every client service, needing only the host's seams. */
export const SlackClient = {
  layer: SlackSocket.layer.pipe(
    Layer.provideMerge(SlackEdge.layer),
    Layer.provideMerge(SlackApi.layer),
    Layer.provideMerge(RequestQueue.layer),
  ) as Layer.Layer<SlackSocket | SlackEdge | SlackApi | RequestQueue, never, SlackSession | HttpTransport | SocketHandshake>,
}
