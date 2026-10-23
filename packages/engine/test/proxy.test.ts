// The socket honours the system proxy (architecture 2.2): main answers the
// handshake with Chromium's proxy list and `ws` connects through it.
import { createServer, type Server } from 'node:http'
import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'bun:test'
import { proxyFor } from '../src/session/handshake'
import type { RunningEngine } from './harness'
import { bootedEngine } from './scenario'

const engines: Array<RunningEngine> = []
const servers: Array<Server> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve))
})

/** An HTTP CONNECT proxy on a free port that records each tunnel's target. */
async function connectProxy(): Promise<{ readonly port: number; readonly tunnels: Array<string> }> {
  const tunnels: Array<string> = []
  const server = createServer((_request, response) => response.writeHead(405).end())
  server.on('connect', (request, client, head) => {
    const target = request.url ?? ''
    tunnels.push(target)
    const [host = '', port = ''] = target.split(':')
    const upstream = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { port: address.port, tunnels }
}

describe('socket proxy', () => {
  it('reconnects through the HTTP proxy main names and still receives events', async () => {
    const proxy = await connectProxy()
    const engine = await bootedEngine(engines)
    const fakeHost = new URL(engine.fake.url).host
    engine.main.network.proxy = `PROXY 127.0.0.1:${proxy.port}; DIRECT`
    engine.fake.dropSocket()
    await engine.phase('offline')
    await engine.phase('live', 30_000)
    expect(proxy.tunnels).toEqual([fakeHost])

    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Through the proxy.' })
    await engine.rowsUntil((rows) => rows.some((r) => r.preview.text === 'Through the proxy.'), 'the event over the proxied socket')
  })

  it('reads the proxy list in order and keeps only what ws can use', () => {
    expect(proxyFor('DIRECT')).toBeUndefined()
    expect(proxyFor('')).toBeUndefined()
    expect(proxyFor('PROXY proxy.corp:8080; DIRECT')).toBe('http://proxy.corp:8080')
    expect(proxyFor('HTTPS secure.corp:443')).toBe('https://secure.corp:443')
    expect(proxyFor('SOCKS5 socks.corp:1080; PROXY proxy.corp:3128')).toBe('http://proxy.corp:3128')
    expect(proxyFor('SOCKS5 socks.corp:1080')).toBe('unsupported')
  })
})
