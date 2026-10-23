/**
 * `pnpm notif:replay label --dir DIR`: serves the labelling page on
 * 127.0.0.1 and saves each change to `DIR/labels.json`. Ctrl-C stops it.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { flags, required } from './model'

const MAX_BODY = 5_000_000

export async function serve(argv: ReadonlyArray<string>) {
  const options = flags(argv)
  const dir = resolve(required(options, 'dir'))
  const port = Number(options.port ?? 4791)
  const pagePath = join(dir, 'index.html')
  const labelsPath = join(dir, 'labels.json')
  if (!existsSync(pagePath)) throw new Error(`No index.html in ${dir}. Run pnpm notif:replay sample first.`)

  const server = createServer((request, response) => {
    if (request.method === 'GET' && (request.url === '/' || request.url === '/index.html')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(readFileSync(pagePath))
      return
    }
    if (request.url !== '/labels') {
      response.writeHead(404).end()
      return
    }
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(existsSync(labelsPath) ? readFileSync(labelsPath) : '{}')
      return
    }
    if (request.method !== 'PUT') {
      response.writeHead(405).end()
      return
    }
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
      if (body.length > MAX_BODY) request.destroy()
    })
    request.on('end', () => {
      try {
        const labels = JSON.parse(body) as unknown
        if (typeof labels !== 'object' || labels === null || Array.isArray(labels)) throw new Error('not an object')
        writeFileSync(`${labelsPath}.tmp`, `${JSON.stringify(labels, null, 1)}\n`)
        renameSync(`${labelsPath}.tmp`, labelsPath)
        response.writeHead(204).end()
      } catch (error) {
        console.error(`Could not save labels: ${String(error)}`)
        response.writeHead(400).end()
      }
    })
  })
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done))
  console.log(`Labelling page: http://127.0.0.1:${port}/  Labels save to ${labelsPath}. Ctrl-C stops it.`)
  await new Promise<void>((done) => process.on('SIGINT', () => server.close(() => done())))
}
