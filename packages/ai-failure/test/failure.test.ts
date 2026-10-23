/**
 * Provider errors sorted into kinds, from the text pi-ai gives: the SDK's
 * "<status> <body>" or "<status>: <body>", pi's "Provider (<status>): …",
 * a refusal's explanation, or a network error. The bodies are shaped like
 * OpenRouter's (`{ error: { code, message, metadata } }`); none is real.
 */
import { describe, expect, it } from 'bun:test'
import { classifyFailure, modelMaker, refusedBeforeOutput } from '../src/index'

const body = (code: number, message: string, metadata?: object) => JSON.stringify({ error: { code, message, ...(metadata ? { metadata } : {}) } })

describe('classifyFailure', () => {
  it.each([
    // The owner's report: Anthropic's refusal, as pi-ai passes its explanation on.
    ['policy', "This request triggered restrictions on violative cyber content and was blocked under Anthropic's Usage Policy."],
    ['policy', `403 ${body(403, 'Input was flagged by moderation', { reasons: ['violence'], flagged_input: 'an invented line', provider_name: 'OpenAI', model_slug: 'openai/gpt-6-luna' })}`],
    ['policy', `400: ${body(400, 'Your request was blocked by our content policy.')}`],
    ['policy', 'Provider finish_reason: content_filter'],
    ['policy', 'The model refused to complete the request'],
    ['credits', `402 ${body(402, 'This request requires more credits, or fewer max_tokens.')}`],
    ['context-length', `400 ${body(400, "This endpoint's maximum context length is 128000 tokens. However, you requested about 140211 tokens.")}`],
    ['context-length', `413: ${body(413, 'Payload too large')}`],
    ['model-not-found', `404 ${body(404, 'No endpoints found for anthropic/claude-sonnet-9.')}`],
    ['model-not-found', `400 ${body(400, 'anthropic/claude-sonet-5.5 is not a valid model ID')}`],
    ['auth', `401 ${body(401, 'No auth credentials found')}`],
    ['auth', `403 ${body(403, 'Key is disabled')}`],
    ['rate-limited', `429 ${body(429, 'Rate limit exceeded: free-models-per-min.')}`],
    ['unavailable', `502 ${body(502, 'Upstream error from Anthropic: Overloaded')}`],
    ['unavailable', `OpenRouter (503): ${body(503, 'No available model provider that meets your routing requirements')}`],
    ['unavailable', '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'],
    ['server', `500 ${body(500, 'Internal Server Error')}`],
    ['timeout', `408 ${body(408, 'Request timed out')}`],
    ['bad-request', `400 ${body(400, 'tools.0.function.parameters: invalid schema')}`],
    ['network', 'fetch failed'],
    ['network', 'getaddrinfo ENOTFOUND openrouter.ai'],
    // A refused connection is the network, not a refusal.
    ['network', 'connect ECONNREFUSED 127.0.0.1:443'],
    // A mid-stream error in a 200 response carries its code in the body.
    ['unavailable', body(502, 'Provider returned error')],
    ['unknown', 'Something odd happened'],
  ])('%s: %s', (kind, text) => {
    expect(classifyFailure(text)).toBe<string>(kind)
  })
})

describe('billing and fallback', () => {
  it('counts a 4xx before output as unbilled, and an error inside a 200 stream as possibly billed', () => {
    expect(refusedBeforeOutput(`400 ${body(400, 'Your request was blocked by our content policy.')}`)).toBe(true)
    expect(refusedBeforeOutput(`402 ${body(402, 'Insufficient credits')}`)).toBe(true)
    expect(refusedBeforeOutput("This request triggered restrictions on violative cyber content and was blocked under Anthropic's Usage Policy.")).toBe(false)
    expect(refusedBeforeOutput(body(403, 'Flagged mid-stream'))).toBe(false)
    expect(refusedBeforeOutput(`408 ${body(408, 'Request timed out')}`)).toBe(false)
    expect(refusedBeforeOutput(`502 ${body(502, 'Bad gateway')}`)).toBe(false)
  })

  it('names the maker of a slug, so a fallback comes from someone else', () => {
    expect(modelMaker('anthropic/claude-sonnet-5.5')).toBe('anthropic')
    expect(modelMaker('~google/gemini-latest')).toBe('google')
    expect(modelMaker('fake')).toBe('fake')
  })
})
