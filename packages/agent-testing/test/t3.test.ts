// The T3 Code fake: the one-time code sign-in, loopback against LAN, a missing tool and scripted threads.
import { afterEach, expect, it } from 'bun:test'
import { McpClient } from '@earendil-works/pi-mcp'
import { authorizeMcp, McpOAuthAuthorizationRequiredError, OAuthError, OAuthInsecureEndpointError } from '@earendil-works/pi-mcp/oauth'
import { T3_ANSWER_TOOLS, T3_READ_TOOLS, T3_WORK_TOOLS, startFakeT3, type FakeT3 } from '../src/index'
import { session, signIn } from './signIn'

let t3: FakeT3 | undefined
afterEach(async () => {
  await t3?.close()
  t3 = undefined
})

const parse = (result: { content: Array<{ type: string; text?: string }> }) => JSON.parse(result.content[0]!.text!)

it('signs in once with a one-time code and no refresh token', async () => {
  t3 = await startFakeT3()
  const signedIn = await signIn(t3.loopbackUrl, t3.oauth)
  expect(signedIn.redirects[0]!.pathname).toBe('/oauth/mcp/authorize')
  expect(signedIn.redirects[0]!.searchParams.get('scope')).toBe('orchestration:read orchestration:operate')
  expect(signedIn.store.load()?.tokens?.refresh_token).toBeUndefined()
  expect((await signedIn.client.listTools()).map((t) => t.name).toSorted()).toEqual([...T3_READ_TOOLS, ...T3_WORK_TOOLS, ...T3_ANSWER_TOOLS].toSorted())

  // The code is spent: a second exchange is refused.
  const other = session(t3.loopbackUrl)
  await other.provider.saveClientInformation((await signedIn.provider.clientInformation())!)
  await other.provider.saveCodeVerifier(await signedIn.provider.codeVerifier())
  const reuse = authorizeMcp(other.provider, { serverUrl: t3.loopbackUrl, authorizationCode: signedIn.code })
  await expect(reuse).rejects.toBeInstanceOf(OAuthError)
  await expect(reuse).rejects.toMatchObject({ code: 'invalid_grant' })
  await signedIn.client.close()
})

it('answers an expired token with 401 invalid_mcp_credential and needs a new sign-in', async () => {
  t3 = await startFakeT3()
  const response = await fetch(t3.loopbackUrl, { method: 'POST', headers: { authorization: 'Bearer stale', 'content-type': 'application/json' }, body: '{}' })
  expect(response.status).toBe(401)
  expect(await response.json()).toMatchObject({ error: 'invalid_mcp_credential' })
  expect(response.headers.get('www-authenticate')).toContain('resource_metadata=')

  const { client } = await signIn(t3.loopbackUrl, t3.oauth)
  t3.oauth.expireAccessTokens()
  await expect(client.callTool('t3_project_list', {})).rejects.toBeInstanceOf(McpOAuthAuthorizationRequiredError)
  await client.close()
})

it('serves the LAN address too, where pi-mcp refuses the token exchange over plain http', async () => {
  t3 = await startFakeT3()
  const lan = session(t3.lanUrl, t3.fetch)
  await expect(lan.connect()).rejects.toBeInstanceOf(McpOAuthAuthorizationRequiredError)
  expect(new URL(lan.redirects[0]!).host).toBe(new URL(t3.lanUrl).host)
  const code = t3.oauth.approve(lan.redirects[0]!).searchParams.get('code')!
  await expect(authorizeMcp(lan.provider, { serverUrl: t3.lanUrl, authorizationCode: code, fetch: t3.fetch })).rejects.toBeInstanceOf(OAuthInsecureEndpointError)
})

it('can serve the LAN address alone, with loopback refused', async () => {
  t3 = await startFakeT3({ loopback: false })
  await expect(fetch(t3.loopbackUrl, { method: 'POST' })).rejects.toThrow()
  expect((await t3.fetch(t3.lanUrl, { method: 'POST' })).status).toBe(401)
})

it('leaves out a tool when asked', async () => {
  t3 = await startFakeT3({ omitTools: ['t3_thread_wait'] })
  const { client } = await signIn(t3.loopbackUrl, t3.oauth)
  expect((await client.listTools()).map((t) => t.name)).not.toContain('t3_thread_wait')
  await expect(client.callTool('t3_thread_wait', { threadId: 'x' })).rejects.toThrow(/Unknown tool/)
  await client.close()
})

it('runs a scripted thread: launch, a question, an answer, done', async () => {
  t3 = await startFakeT3()
  const client = new McpClient({ name: 'juno-test', version: '0.0.0' })
  await client.connect(t3.connectInMemory())
  const launched = parse(await client.callTool('t3_thread_launch', { title: 'Fix the sidebar flake', message: 'juno:action-1\nFix the flaky sidebar test.' }))
  expect(launched.status).toBe('running')

  const requestId = t3.ask(launched.threadId, 'Run the full suite?')
  expect(parse(await client.callTool('t3_pending_request_list', { threadId: launched.threadId })).requestIds).toEqual([requestId])
  expect(parse(await client.callTool('t3_pending_request_read', { requestId, threadId: launched.threadId })).questions).toEqual([{
    id: 'question', header: 'T3 Code asks', question: 'Run the full suite?', allowCustomAnswer: true, multiSelect: false,
    options: ['Yes', 'No'].map((label) => ({ label, description: '', value: label })),
  }])
  expect(parse(await client.callTool('t3_pending_request_respond', { requestId, answers: { question: 'Yes' } }))).toEqual({ sequence: 1 })
  expect(t3.answers()).toEqual([{ requestId, answers: { question: 'Yes' } }])

  const waiting = client.callTool('t3_thread_wait', { threadId: launched.threadId, timeoutMs: 5_000 })
  t3.advance(launched.threadId, { reply: 'Done. PR #12.', status: 'completed' })
  expect(parse(await waiting)).toMatchObject({ status: 'completed', timedOut: false })
  const read = parse(await client.callTool('t3_thread_read', { threadId: launched.threadId }))
  expect(read.items.map((i: { text: string }) => i.text)).toEqual(['juno:action-1\nFix the flaky sidebar test.', 'Done. PR #12.'])
  expect(parse(await client.callTool('t3_thread_search', { query: 'juno:action-1' })).matches.map((m: { threadId: string }) => m.threadId)).toEqual([launched.threadId])
  expect(parse(await client.callTool('t3_thread_wait', { threadId: launched.threadId, timeoutMs: 10 })).timedOut).toBe(false)
  await client.close()
})

it('times out a wait on a thread that does not move', async () => {
  t3 = await startFakeT3()
  const client = new McpClient({ name: 'juno-test', version: '0.0.0' })
  await client.connect(t3.connectInMemory())
  const { threadId } = parse(await client.callTool('t3_thread_launch', { title: 'Quiet', message: 'Wait.' }))
  expect(parse(await client.callTool('t3_thread_wait', { threadId, timeoutMs: 20 }))).toMatchObject({ status: 'running', timedOut: true })
  await client.close()
})

