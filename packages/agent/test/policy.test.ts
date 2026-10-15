// The action policy's pure rules (plan v3 §6, §9; specs/agent-actions.qnt): authorization, the tier
// table with the clean-run rule, grant authorities and click bindings.
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  authorizeDecision, bindingMatches, mayMintGrant, toolDecision,
  type Authority, type AuthorizeInput, type OpClass, type RunFacts,
} from '../src/policy/policy'

const ON: Authority = { mode: 'on', owner: 'active' }
const intent = { rev: 2, digest: 'd2', tier: 3 as const, deduped: false }
const approval = { rev: 2, digest: 'd2', used: false, batchOrdered: true }
const base: AuthorizeInput = { authority: ON, intent, validity: 'valid', approval, grant: false, prior: [], done: false }

const authority = fc.record({ mode: fc.constantFrom('on', 'paused', 'off'), owner: fc.constantFrom('active', 'released', 'recovery') }) as fc.Arbitrary<Authority>
const validity = fc.constantFrom('valid', 'stale', 'expired', 'sourceChanged', 'schemaChanged', 'accountChanged', 'connectionChanged', 'preconditionFailed') as fc.Arbitrary<AuthorizeInput['validity']>
const input: fc.Arbitrary<AuthorizeInput> = fc.record({
  authority,
  intent: fc.record({ rev: fc.integer({ min: 1, max: 3 }), digest: fc.constantFrom('d1', 'd2'), tier: fc.constantFrom(1, 2, 3, 4) as fc.Arbitrary<1 | 2 | 3 | 4>, deduped: fc.boolean() }),
  validity,
  approval: fc.option(fc.record({ rev: fc.integer({ min: 1, max: 3 }), digest: fc.constantFrom('d1', 'd2'), used: fc.boolean(), batchOrdered: fc.boolean() }), { nil: undefined }),
  grant: fc.boolean(),
  prior: fc.array(fc.constantFrom('d1', 'd2'), { maxLength: 2 }),
  done: fc.boolean(),
}) as fc.Arbitrary<AuthorizeInput>

describe('authorizing a child action', () => {
  it('authorizes an exact, unused click on a current, valid intent', () => {
    expect(authorizeDecision(base)).toEqual({ _tag: 'authorize', via: 'approval' })
  })

  it('refuses while paused, off, or on a Mac that does not own Juno', () => {
    expect(authorizeDecision({ ...base, authority: { mode: 'paused', owner: 'active' } })).toEqual({ _tag: 'refused', reason: 'paused' })
    expect(authorizeDecision({ ...base, authority: { mode: 'off', owner: 'active' } })).toEqual({ _tag: 'refused', reason: 'off' })
    expect(authorizeDecision({ ...base, authority: { mode: 'on', owner: 'recovery' } })).toEqual({ _tag: 'refused', reason: 'notOwner' })
  })

  it('refuses a click on an older revision or another payload', () => {
    expect(authorizeDecision({ ...base, approval: { ...approval, rev: 1 } })).toEqual({ _tag: 'refused', reason: 'noApproval' })
    expect(authorizeDecision({ ...base, approval: { ...approval, digest: 'd1' } })).toEqual({ _tag: 'refused', reason: 'noApproval' })
    expect(authorizeDecision({ ...base, approval: { ...approval, used: true } })).toEqual({ _tag: 'refused', reason: 'noApproval' })
    expect(authorizeDecision({ ...base, approval: { ...approval, batchOrdered: false } })).toEqual({ _tag: 'refused', reason: 'noApproval' })
  })

  it('never authorizes a child twice when its destination does not deduplicate, whatever became of the first', () => {
    expect(authorizeDecision({ ...base, prior: ['d2'] })).toEqual({ _tag: 'refused', reason: 'alreadyAuthorized' })
  })

  it('authorizes a deduplicated child again only with the same payload', () => {
    const deduped = { ...base, intent: { ...intent, deduped: true } }
    expect(authorizeDecision({ ...deduped, prior: ['d2'] })).toEqual({ _tag: 'authorize', via: 'approval' })
    expect(authorizeDecision({ ...deduped, prior: ['d1'] })).toEqual({ _tag: 'refused', reason: 'payloadChanged' })
  })

  it('names why an approved intent can no longer run', () => {
    expect(authorizeDecision({ ...base, validity: 'expired' })).toEqual({ _tag: 'refused', reason: 'invalid', invalid: 'expired' })
    expect(authorizeDecision({ ...base, done: true })).toEqual({ _tag: 'refused', reason: 'done' })
    expect(authorizeDecision({ ...base, intent: { ...intent, tier: 4 } })).toEqual({ _tag: 'refused', reason: 'destructive' })
  })

  it('lets a grant stand in for a click on Tier 2 only', () => {
    const { approval: _, ...noClick } = base
    expect(authorizeDecision({ ...noClick, grant: true, intent: { ...intent, tier: 2 } })).toEqual({ _tag: 'authorize', via: 'grant' })
    expect(authorizeDecision({ ...noClick, grant: true })).toEqual({ _tag: 'refused', reason: 'noApproval' })
  })

  it('holds the spec properties for any facts', () => {
    fc.assert(fc.property(input, (facts) => {
      const decision = authorizeDecision(facts)
      if (decision._tag !== 'authorize') return
      // pauseBlocksAuthorization, currentOwnerAuthorizes
      expect(facts.authority).toEqual(ON)
      // tier4NeverDispatched
      expect(facts.intent.tier).not.toBe(4)
      // approvalCurrentAtAuthorization
      expect(facts.validity).toBe('valid')
      expect(facts.done).toBe(false)
      // noRepeatAuthorization
      if (!facts.intent.deduped) expect(facts.prior).toEqual([])
      else expect(facts.prior.every((d) => d === facts.intent.digest)).toBe(true)
      if (decision.via === 'approval') {
        // approvalExact, approvalConsumption
        expect(facts.approval).toEqual({ rev: facts.intent.rev, digest: facts.intent.digest, used: false, batchOrdered: true })
      } else {
        // scopedNoClickGrant
        expect(facts.grant).toBe(true)
        expect(facts.intent.tier).toBe(2)
      }
    }), { numRuns: 2000 })
  })
})

describe('what a tool call does, by tier and run', () => {
  const clean: RunFacts = { origin: 'owner', clean: true }
  const tainted: RunFacts = { origin: 'owner', clean: false }
  const wake: RunFacts = { origin: 'wake', clean: false }
  const report: RunFacts = { origin: 'report', clean: false }

  it('follows the tier table in a clean owner run, a tainted one, and a wake', () => {
    const table: ReadonlyArray<[OpClass, string, string, string]> = [
      ['read', 'run', 'run', 'run'],
      ['local', 'run', 'run', 'run'],
      ['scheduleCreate', 'run', 'card', 'refused'],
      ['notificationsSet', 'run', 'card', 'refused'],
      ['t3Start', 'card', 'card', 'card'],
      ['delegateSpawn', 'run', 'card', 'card'],
      ['outward', 'card', 'card', 'card'],
      ['destructive', 'refused', 'refused', 'refused'],
    ]
    for (const [op, inClean, inTainted, inWake] of table) {
      expect([op, toolDecision(op, clean)._tag, toolDecision(op, tainted)._tag, toolDecision(op, wake)._tag]).toEqual([op, inClean, inTainted, inWake])
    }
  })

  it('carries the Because line only when untrusted content made it a card', () => {
    expect(toolDecision('outward', clean)).toEqual({ _tag: 'card', because: false })
    expect(toolDecision('t3Start', clean)).toEqual({ _tag: 'card', because: false })
    expect(toolDecision('t3Start', tainted)).toEqual({ _tag: 'card', because: true })
    expect(toolDecision('delegateSpawn', tainted)).toEqual({ _tag: 'card', because: true })
  })

  it('steers or stops a job with no click only under its live grant in a clean owner run', () => {
    expect(toolDecision('steer', clean, { liveGrant: true })).toEqual({ _tag: 'run' })
    expect(toolDecision('steer', clean, { liveGrant: false })).toEqual({ _tag: 'card', because: true })
    expect(toolDecision('steer', tainted, { liveGrant: true })).toEqual({ _tag: 'card', because: true })
    expect(toolDecision('stopJob', clean, { liveGrant: true })).toEqual({ _tag: 'run' })
    expect(toolDecision('stopJob', report, { liveGrant: true })).toEqual({ _tag: 'refused', reason: 'useTaskCard' })
  })

  it('lets a wake pause or delete only the schedule that woke it', () => {
    expect(toolDecision('ownSchedule', wake, { wokeThisRun: true })).toEqual({ _tag: 'run' })
    expect(toolDecision('ownSchedule', wake, { wokeThisRun: false })).toEqual({ _tag: 'refused', reason: 'notOwnSchedule' })
  })

  it('never runs a Tier 2 or 3 call with no click once the run has read untrusted content', () => {
    const op = fc.constantFrom<OpClass>('scheduleCreate', 'notificationsSet', 't3Start', 'delegateSpawn', 'steer', 'stopJob', 'outward', 'destructive')
    const run = fc.record({ origin: fc.constantFrom('owner', 'wake', 'report', 'click'), clean: fc.constant(false) }) as fc.Arbitrary<RunFacts>
    fc.assert(fc.property(op, run, fc.boolean(), (o, r, grant) => {
      expect(toolDecision(o, r, { liveGrant: grant })._tag).not.toBe('run')
    }))
  })
})

describe('who may mint a grant', () => {
  it('is a clean owner run with its source in the run, a current click, or the menu, and only while Juno may act', () => {
    expect(mayMintGrant({ _tag: 'cleanRun', run: { origin: 'owner', clean: true }, sourceInRun: true }, ON)).toBe(true)
    expect(mayMintGrant({ _tag: 'cleanRun', run: { origin: 'owner', clean: false }, sourceInRun: true }, ON)).toBe(false)
    expect(mayMintGrant({ _tag: 'cleanRun', run: { origin: 'owner', clean: true }, sourceInRun: false }, ON)).toBe(false)
    expect(mayMintGrant({ _tag: 'cleanRun', run: { origin: 'report', clean: true }, sourceInRun: true }, ON)).toBe(false)
    expect(mayMintGrant({ _tag: 'click', current: true }, ON)).toBe(true)
    expect(mayMintGrant({ _tag: 'click', current: false }, ON)).toBe(false)
    // The menu's reply watch: what the chat has read does not matter (spec scheduleFromMenu).
    expect(mayMintGrant({ _tag: 'menu' }, ON)).toBe(true)
    for (const now of [{ mode: 'paused', owner: 'active' }, { mode: 'off', owner: 'active' }, { mode: 'on', owner: 'released' }] as const) {
      expect(mayMintGrant({ _tag: 'menu' }, now)).toBe(false)
      expect(mayMintGrant({ _tag: 'click', current: true }, now)).toBe(false)
    }
  })
})

describe('a click binds the card the owner saw', () => {
  const children = [
    { actionId: 'a1', revision: 1, digest: 'x' },
    { actionId: 'a2', revision: 2, digest: 'y' },
  ]
  const stored = { revision: 3, digest: 'card', children }

  it('matches only the same revision, digest and children in the same order', () => {
    expect(bindingMatches(stored, stored)).toBe(true)
    expect(bindingMatches(stored, { ...stored, revision: 2 })).toBe(false)
    expect(bindingMatches(stored, { ...stored, digest: 'other' })).toBe(false)
    expect(bindingMatches(stored, { ...stored, children: children.toReversed() })).toBe(false)
    expect(bindingMatches(stored, { ...stored, children: [children[0]!] })).toBe(false)
    expect(bindingMatches(stored, { ...stored, children: [children[0]!, { ...children[1]!, revision: 1 }] })).toBe(false)
  })
})
