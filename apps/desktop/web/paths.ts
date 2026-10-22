/**
 * The addresses the web shell's page and host agree on. Both are on the
 * page's own origin, so `--host` and any port work without configuration.
 */

/** The engine's WebSocket (`@juno/state/socket` on the page, `socketTransport` in the host). */
export const ENGINE_SOCKET_PATH = '/__juno/engine'

/** What `juno://<host>/<rest>` becomes on the page: `/__juno/<host>/<rest>`, which the host serves. */
export const SCHEME_PREFIX = '/__juno/'

/** A download the page asks for, as `?url=<Slack file url>&name=<name>`. */
export const DOWNLOAD_PATH = '/__juno/download'
