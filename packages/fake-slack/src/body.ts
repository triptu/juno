/**
 * Request body parsing. The official client sends multipart/form-data; the
 * edge API takes JSON; tests may send URL-encoded forms. All three give a flat
 * record of field names to values.
 */
import type { IncomingMessage } from 'node:http'

export type FormFields = Record<string, string>

export async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** Parses a body into fields. JSON bodies keep non-string values as JSON text so one type fits all. */
export function parseFields(contentType: string | undefined, body: Buffer): FormFields {
  const type = (contentType ?? '').toLowerCase()
  if (type.startsWith('multipart/form-data')) return parseMultipart(contentType ?? '', body)
  if (type.startsWith('application/json')) {
    const json = body.length === 0 ? {} : (JSON.parse(body.toString('utf8')) as Record<string, unknown>)
    const fields: FormFields = {}
    for (const [key, value] of Object.entries(json)) {
      fields[key] = typeof value === 'string' ? value : JSON.stringify(value)
    }
    return fields
  }
  const fields: FormFields = {}
  for (const [key, value] of new URLSearchParams(body.toString('utf8'))) fields[key] = value
  return fields
}

export function parseJson(body: Buffer): Record<string, unknown> {
  return body.length === 0 ? {} : (JSON.parse(body.toString('utf8')) as Record<string, unknown>)
}

function parseMultipart(contentType: string, body: Buffer): FormFields {
  const fields: FormFields = {}
  for (const part of parseMultipartParts(contentType, body)) fields[part.name] = part.data.toString('utf8')
  return fields
}

export interface MultipartPart {
  readonly name: string
  readonly filename: string | undefined
  readonly contentType: string | undefined
  readonly data: Buffer
}

/** The parts of a multipart/form-data body, bytes untouched (file uploads are binary). */
export function parseMultipartParts(contentType: string, body: Buffer): MultipartPart[] {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  const boundary = match?.[1] ?? match?.[2]
  if (boundary === undefined) throw new Error('multipart body without a boundary')
  const delimiter = Buffer.from(`--${boundary.trim()}`)
  const parts: MultipartPart[] = []
  let position = body.indexOf(delimiter)
  while (position !== -1) {
    const start = position + delimiter.length
    // The closing delimiter is "--boundary--".
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break
    const next = body.indexOf(delimiter, start)
    const part = body.subarray(start, next === -1 ? body.length : next)
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8')
      const name = /[;\s]name="([^"]*)"/i.exec(headers)?.[1]
      if (name !== undefined) {
        let data = part.subarray(headerEnd + 4)
        if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) data = data.subarray(0, data.length - 2)
        parts.push({
          name,
          filename: /filename="([^"]*)"/i.exec(headers)?.[1],
          contentType: /^content-type:\s*(.+)$/im.exec(headers)?.[1]?.trim(),
          data,
        })
      }
    }
    position = next
  }
  return parts
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const pair of (header ?? '').split(';')) {
    const index = pair.indexOf('=')
    if (index === -1) continue
    cookies[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim())
  }
  return cookies
}
