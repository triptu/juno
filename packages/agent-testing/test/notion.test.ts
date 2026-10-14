// The Notion fake through pi-mcp's real client and OAuth flow.
import { afterEach, expect, it } from 'vitest'
import { McpOAuthAuthorizationRequiredError } from '@earendil-works/pi-mcp/oauth'
import { startFakeNotion, type FakeNotion } from '../src/index'
import { signIn } from './signIn'

let notion: FakeNotion | undefined
afterEach(async () => {
  await notion?.close()
  notion = undefined
})

const parse = (result: { content: Array<{ type: string; text?: string }> }) => JSON.parse(result.content[0]!.text!)

it('signs in with OAuth and reads pages', async () => {
  notion = await startFakeNotion()
  const { client } = await signIn(notion.url, notion.oauth)
  expect((await client.listTools()).map((t) => t.name)).toEqual(['notion-search', 'notion-fetch', 'notion-create-pages', 'notion-update-page', 'notion-get-self'])
  const found = parse(await client.callTool('notion-search', { query: 'launch' }))
  expect(found.results.map((r: { id: string }) => r.id)).toEqual(['page-notes'])
  expect(notion.oauth.stats()).toMatchObject({ registrations: 1, exchanges: 1 })
  await client.close()
})

it('answers an expired token with 401, which pi-mcp refreshes', async () => {
  notion = await startFakeNotion()
  const { client } = await signIn(notion.url, notion.oauth)
  const before = notion.rejected()
  notion.oauth.expireAccessTokens()
  const page = parse(await client.callTool('notion-fetch', { id: 'page-roadmap' }))
  expect(page.title).toBe('Roadmap')
  expect(notion.rejected()).toBe(before + 1)
  expect(notion.oauth.stats().refreshes).toBe(1)
  await client.close()
})

it('sends the owner to sign in again when the refresh token is revoked', async () => {
  notion = await startFakeNotion()
  const { client, redirects } = await signIn(notion.url, notion.oauth)
  notion.oauth.expireAccessTokens()
  notion.oauth.revokeRefreshTokens()
  await expect(client.callTool('notion-fetch', { id: 'page-roadmap' })).rejects.toBeInstanceOf(McpOAuthAuthorizationRequiredError)
  expect(redirects).toHaveLength(2)
  await client.close()
})

it('loses a write that Notion applied: only a read back shows it', async () => {
  notion = await startFakeNotion()
  const { client } = await signIn(notion.url, notion.oauth)
  notion.loseNextWrite()
  await expect(client.callTool('notion-update-page', { page_id: 'page-roadmap', command: 'replace_content', content: 'Q4: ship search.' })).rejects.toThrow()
  const page = parse(await client.callTool('notion-fetch', { id: 'page-roadmap' }))
  expect(page.content).toBe('Q4: ship search.')
  await client.close()
})

it('moves last_edited_time when the page is edited elsewhere', async () => {
  notion = await startFakeNotion()
  const { client } = await signIn(notion.url, notion.oauth)
  const read = parse(await client.callTool('notion-fetch', { id: 'page-roadmap' }))
  notion.editElsewhere('page-roadmap', 'Q4: someone else wrote this.')
  const again = parse(await client.callTool('notion-fetch', { id: 'page-roadmap' }))
  expect(again.last_edited_time > read.last_edited_time).toBe(true)
  expect(again.content).toBe('Q4: someone else wrote this.')
  await client.close()
})
