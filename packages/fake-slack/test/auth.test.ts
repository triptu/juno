import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeSlack, type FakeSlack } from '../src/index.ts'
import { SocketClient, TestClient } from './helpers.ts'

let fake: FakeSlack
let client: TestClient

beforeAll(async () => {
  fake = await startFakeSlack()
  client = new TestClient(fake)
})

afterAll(async () => {
  await fake.close()
})

describe('authentication', () => {
  it('needs both the token field and the d cookie', async () => {
    expect((await client.call('client.counts', {}, { cookie: null })).body).toEqual({ ok: false, error: 'invalid_auth' })
    expect((await client.call('client.counts', {}, { token: null })).body).toEqual({ ok: false, error: 'not_authed' })
    expect((await client.call('client.counts', {}, { token: 'xoxc-wrong' })).body).toEqual({ ok: false, error: 'invalid_auth' })
    expect((await client.call('client.counts', {}, { cookie: 'wrong' })).body).toEqual({ ok: false, error: 'invalid_auth' })
    expect((await client.call('client.counts', {})).body.ok).toBe(true)
  })

  it('the edge API needs the cookie too', async () => {
    expect(await client.edge('users/info', { ids: ['U0MAYA'] }, { cookie: null })).toEqual({ ok: false, error: 'invalid_auth' })
  })

  it('rejects a socket upgrade without the cookie or with a bad token', async () => {
    const { primary_websocket_url } = await client.ok('client.getWebSocketURL', {})
    const url = new URL(primary_websocket_url)
    url.searchParams.set('token', client.credentials.token)
    const noCookie = new SocketClient(url.toString(), null)
    await expect(noCookie.opened).rejects.toThrow('HTTP 401')
    url.searchParams.set('token', 'xoxc-wrong')
    const badToken = new SocketClient(url.toString(), client.credentials.cookie)
    await expect(badToken.opened).rejects.toThrow('HTTP 401')
  })

  it('answers unknown methods and bad arguments like Slack', async () => {
    const form = new FormData()
    form.set('token', client.credentials.token)
    const unknown = await fetch(`${fake.url}/api/nope.method`, { method: 'POST', body: form, headers: { cookie: `d=${client.credentials.cookie}` } })
    expect(await unknown.json()).toEqual({ ok: false, error: 'unknown_method' })
    const bad = await fetch(`${fake.url}/api/conversations.history`, { method: 'POST', body: form, headers: { cookie: `d=${client.credentials.cookie}` } })
    expect(await bad.json()).toEqual({ ok: false, error: 'invalid_arguments' })
  })

  it('sign-in sets the cookie and the client page stores localConfig_v2', async () => {
    const page = await fetch(`${fake.url}/signin`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<form method="post" action="/signin">')

    const submit = await fetch(`${fake.url}/signin`, {
      method: 'POST',
      body: new URLSearchParams({ email: 'tushar@juno-fake.test', password: 'anything' }),
      redirect: 'manual',
    })
    expect(submit.status).toBe(303)
    expect(submit.headers.get('location')).toBe(`/client/${fake.teamId}`)
    const setCookie = submit.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/^d=fake-d-[0-9a-f]+; Path=\/; HttpOnly; SameSite=Lax$/)
    const cookie = /^d=([^;]+)/.exec(setCookie)![1]!

    const withoutCookie = await fetch(`${fake.url}/client/${fake.teamId}`, { redirect: 'manual' })
    expect(withoutCookie.status).toBe(302)

    const clientPage = await fetch(`${fake.url}/client/${fake.teamId}`, { headers: { cookie: `d=${cookie}` } })
    const html = await clientPage.text()
    const stored = /localStorage\.setItem\('localConfig_v2', (".*")\);/.exec(html)![1]!
    const localConfig = JSON.parse(JSON.parse(stored) as string) as {
      teams: Record<string, { id: string; url: string; token: string; user_id: string }>
      lastActiveTeamId: string
      orderedTeamIds: string[]
    }
    expect(localConfig.lastActiveTeamId).toBe(fake.teamId)
    expect(localConfig.orderedTeamIds).toEqual([fake.teamId])
    const team = localConfig.teams[fake.teamId]!
    expect(team.url).toBe(`${fake.url}/`)
    expect(team.token).toMatch(/^xoxc-/)
    expect(team.user_id).toBe(fake.selfId)

    // The captured token and cookie work together, and not apart.
    const signedIn = new TestClient(fake, { url: fake.url, token: team.token, cookie, teamId: fake.teamId, userId: team.user_id })
    expect((await signedIn.call('client.counts', {})).body.ok).toBe(true)
    expect((await signedIn.call('client.counts', {}, { cookie: client.credentials.cookie })).body).toEqual({ ok: false, error: 'invalid_auth' })
  })
})
