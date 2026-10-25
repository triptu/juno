// The unfurl image fetch must never reach this Mac or its network: not by
// scheme, an address in the URL, or a name whose DNS answer is private.
import { expect, it } from 'bun:test'
import { publicImage } from '../src/main/publicImage'

const refusal = (url: string) => publicImage(new URL(url)).then(() => 'fetched', (error: Error) => error.message)

it('refuses other schemes, credentials and ports before any request', async () => {
  for (const url of ['file:///tmp/image.png', 'http://example.com/image.png', 'https://user:secret@example.com/image.png', 'https://example.com:8443/image.png']) {
    expect(await refusal(url), url).toBe('Invalid image URL')
  }
})

it('refuses private and local addresses, written in any form', async () => {
  for (const url of ['https://127.0.0.1/image.png', 'https://[::1]/image.png', 'https://10.1.2.3/image.png', 'https://169.254.169.254/latest', 'https://[::ffff:127.0.0.1]/image.png', 'https://[fe80::1]/image.png']) {
    expect(await refusal(url), url).toBe('Non-public image host')
  }
})

it('refuses a name whose DNS answer is local, before connecting', async () => {
  expect(await refusal('https://localhost/image.png')).toBe('Non-public image host')
})
