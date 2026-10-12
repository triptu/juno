/**
 * The HTTP seam (ADR 0007). `SlackApi` and `SlackEdge` depend only on this
 * service. Two implementations:
 *
 * - `NodeFetch` (here): Node's global `fetch`. Cookies are not automatic, so
 *   the caller passes the `Cookie` header (and any other header) explicitly.
 *   Used by tests against the fake and by any Node host.
 * - `ElectronNet` (in the app, later): `net.fetch` on the `persist:slack`
 *   session, where Chromium attaches the `d` cookie and stores rotations.
 *
 * Both read the whole body: Slack answers are JSON and small enough, and a
 * complete body keeps retries simple.
 */
import { Context, Effect, Layer, Schema as S } from 'effect'

export interface HttpRequest {
  readonly url: string
  readonly method: 'GET' | 'POST'
  readonly headers: Readonly<Record<string, string>>
  /** `FormData` for Web API calls, a string for JSON edge calls. */
  readonly body?: FormData | string
}

export interface HttpResponse {
  readonly status: number
  /** Header lookup, case-insensitive. */
  header(name: string): string | undefined
  readonly text: string
}

/** The request never produced a response: DNS, connection, abort or a body read failure. */
export class HttpTransportError extends S.TaggedError<HttpTransportError>()('HttpTransportError', {
  message: S.String,
}) {}

export class HttpTransport extends Context.Service<
  HttpTransport,
  {
    request(request: HttpRequest): Effect.Effect<HttpResponse, HttpTransportError>
  }
>()('juno/slack/HttpTransport') {
  /**
   * Node `fetch`. `headers` are added to every request (the test cookie goes
   * here as `cookie: 'd=...'`). `fetch` can be replaced to fault-inject.
   */
  static readonly nodeFetch = (
    options: { readonly headers?: Readonly<Record<string, string>>; readonly fetch?: typeof fetch } = {},
  ): Layer.Layer<HttpTransport> =>
    Layer.succeed(HttpTransport, {
      request: (request) =>
        Effect.tryPromise({
          try: async (signal) => {
            const doFetch = options.fetch ?? fetch
            const response = await doFetch(request.url, {
              method: request.method,
              headers: { ...options.headers, ...request.headers },
              body: request.body,
              signal,
              redirect: 'manual',
            })
            const text = await response.text()
            return {
              status: response.status,
              header: (name) => response.headers.get(name) ?? undefined,
              text,
            } satisfies HttpResponse
          },
          catch: (cause) => new HttpTransportError({ message: cause instanceof Error ? cause.message : String(cause) }),
        }),
    })
}
