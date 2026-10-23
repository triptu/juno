// The action policy's pure rules (plan v3 §6, §9; specs/agent-actions.qnt): authorization, the tier
// table with the clean-run rule, grant authorities and click bindings.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import {
  authorizeDecision, bindingMatches, floorRisk, mayMintGrant, needsReview, reviewDecision, toolDecision,
  type Authority, type AuthorizeInput, type OpClass, type Review, type RunFacts,
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
  const { approval: _, ...noClick } = base
  it('authorizes only an exact, current click or a Tier 2 grant, and names why it refuses the rest', () => {
    const table: ReadonlyArray<[string, AuthorizeInput, ReturnType<typeof authorizeDecision>]> = [
      ['an exact, unused click on a current, valid intent', base, { _tag: 'authorize', via: 'approval' }],
      ['a click while paused', { ...base, authority: { mode: 'paused', owner: 'active' } }, { _tag: 'refused', reason: 'paused' }],
      ['a click on a Mac that does not own Juno', { ...base, authority: { mode: 'on', owner: 'recovery' } }, { _tag: 'refused', reason: 'notOwner' }],
      ['a click on an older revision', { ...base, approval: { ...approval, rev: 1 } }, { _tag: 'refused', reason: 'noApproval' }],
      ['a second authorization where the destination does not deduplicate', { ...base, prior: ['d2'] }, { _tag: 'refused', reason: 'alreadyAuthorized' }],
      ['a deduplicated child again with the same payload', { ...base, intent: { ...intent, deduped: true }, prior: ['d2'] }, { _tag: 'authorize', via: 'approval' }],
      ['a deduplicated child again with another payload', { ...base, intent: { ...intent, deduped: true }, prior: ['d1'] }, { _tag: 'refused', reason: 'payloadChanged' }],
      ['an intent that expired', { ...base, validity: 'expired' }, { _tag: 'refused', reason: 'invalid', invalid: 'expired' }],
      ['an intent already done', { ...base, done: true }, { _tag: 'refused', reason: 'done' }],
      ['a Tier 4 intent', { ...base, intent: { ...intent, tier: 4 } }, { _tag: 'refused', reason: 'destructive' }],
      ['a grant on Tier 2', { ...noClick, grant: true, intent: { ...intent, tier: 2 } }, { _tag: 'authorize', via: 'grant' }],
      ['a grant on Tier 3', { ...noClick, grant: true }, { _tag: 'refused', reason: 'noApproval' }],
    ]
    for (const [what, facts, decision] of table) expect(authorizeDecision(facts), what).toEqual(decision)
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
      expect([op, toolDecision(op, clean)._tag, toolDecision(op, tainted)._tag, toolDecision(op, wake)._tag]).toEqual<string[]>([op, inClean, inTainted, inWake])
    }
  })

  it('carries the Because line only when untrusted content made it a card', () => {
    expect(toolDecision('t3Start', clean)).toEqual({ _tag: 'card', because: false })
    expect(toolDecision('t3Start', tainted)).toEqual({ _tag: 'card', because: true })
  })

  it('steers a job with no click only under its live grant in a clean owner run, and never stops one from a report', () => {
    expect(toolDecision('steer', clean, { liveGrant: true })).toEqual({ _tag: 'run' })
    expect(toolDecision('steer', clean, { liveGrant: false })._tag).toBe('card')
    expect(toolDecision('steer', tainted, { liveGrant: true })._tag).toBe('card')
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
    expect(mayMintGrant({ _tag: 'cleanRun', run: { origin: 'report', clean: true }, sourceInRun: true }, ON)).toBe(false)
    expect(mayMintGrant({ _tag: 'click', current: false }, ON)).toBe(false)
    // The menu's reply watch: what the chat has read does not matter (spec scheduleFromMenu).
    expect(mayMintGrant({ _tag: 'menu' }, ON)).toBe(true)
    expect(mayMintGrant({ _tag: 'menu' }, { mode: 'paused', owner: 'active' })).toBe(false)
    expect(mayMintGrant({ _tag: 'click', current: true }, { mode: 'on', owner: 'released' })).toBe(false)
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
    expect(bindingMatches(stored, { ...stored, children: children.toReversed() })).toBe(false)
    expect(bindingMatches(stored, { ...stored, children: [children[0]!, { ...children[1]!, revision: 1 }] })).toBe(false)
  })
})

// The auto-review of a connection call (SPEC 13.9; spec `reviewAllows`, `reviewGated`, `untrustedNeverAuthorizes`).
describe('the auto-review of a connection call', () => {
  const rule = fc.constantFrom('auto', 'always', 'never') as fc.Arbitrary<'auto' | 'always' | 'never'>
  const review: fc.Arbitrary<Review> = fc.oneof(
    fc.constant({ _tag: 'failed' } as const),
    fc.constant({ _tag: 'skipped' } as const),
    fc.record({ _tag: fc.constant('answered' as const), intent: fc.constantFrom('explicit', 'implied', 'notAsked'), risk: fc.constantFrom('read', 'reversible', 'write', 'delete', 'send') }) as fc.Arbitrary<Review>,
  )
  const answered = (intent: 'explicit' | 'implied' | 'notAsked', risk: 'read' | 'reversible' | 'write' | 'delete' | 'send'): Review => ({ _tag: 'answered', intent, risk })

  it('runs with no click what the rule and the review allow, and asks for the rest', () => {
    const table: ReadonlyArray<[string, 'auto' | 'always' | 'never', boolean, Review, ReturnType<typeof reviewDecision>]> = [
      ['Auto runs what the owner asked for exactly and can be undone', 'auto', false, answered('explicit', 'reversible'), { _tag: 'run', line: 'ranExplicit' }],
      ['Auto asks for what was only implied', 'auto', true, answered('implied', 'reversible'), { _tag: 'card', line: 'implied' }],
      ['Auto asks for a send the owner asked for', 'auto', true, answered('explicit', 'send'), { _tag: 'card', line: 'send' }],
      ['Auto runs a lookup the owner implied', 'auto', false, answered('implied', 'read'), { _tag: 'run', line: 'ranRead' }],
      ['Auto asks for a lookup the owner never asked for', 'auto', false, answered('notAsked', 'read'), { _tag: 'card', line: 'notAsked' }],
      ['Always ask asks even for an explicit lookup', 'always', false, answered('explicit', 'read'), { _tag: 'card', line: 'always' }],
      ['Never ask runs with no review in a clean run', 'never', true, { _tag: 'skipped' }, { _tag: 'run', line: 'ranNever' }],
      ['Never ask still asks for what cannot be undone', 'never', false, answered('implied', 'delete'), { _tag: 'card', line: 'delete' }],
      ['a review that failed asks under any rule', 'never', false, { _tag: 'failed' }, { _tag: 'card', line: 'failed' }],
    ]
    for (const [what, rule, clean, review, decision] of table) expect(reviewDecision(rule, clean, review), what).toEqual(decision)
  })

  it('never takes a call that looks like a delete as reversible or a lookup', () => {
    expect(floorRisk(answered('explicit', 'reversible'), true)).toEqual(answered('explicit', 'delete'))
    expect(floorRisk(answered('implied', 'read'), true)).toEqual(answered('implied', 'delete'))
    expect(floorRisk(answered('explicit', 'send'), true)).toEqual(answered('explicit', 'send'))
  })

  it('reviews only where a rule needs it: always under Auto, and under Never ask once the run read something', () => {
    expect([needsReview('auto', true), needsReview('always', false), needsReview('never', true), needsReview('never', false)]).toEqual([true, false, false, true])
  })

  it('never lets a call only untrusted text asked for run, under any rule', () => {
    // The reviewer sees only the owner's words, so such a call is answered notAsked; a run that read nothing cannot hold one.
    fc.assert(fc.property(rule, fc.constantFrom('read', 'reversible', 'write', 'delete', 'send'), (r, risk) =>
      reviewDecision(r, false, answered('notAsked', risk as 'reversible'))._tag === 'card'))
  })

  it('runs with no click only as the spec allows', () => {
    fc.assert(fc.property(rule, fc.boolean(), review, (r, clean, rv) => {
      const decision = reviewDecision(r, clean, rv)
      if (decision._tag === 'card') return true
      if (r === 'always') return false
      if (r === 'never') return clean || (rv._tag === 'answered' && rv.intent !== 'notAsked')
      return rv._tag === 'answered' && ((rv.intent === 'explicit' && rv.risk === 'reversible') || (rv.intent !== 'notAsked' && rv.risk === 'read'))
    }))
  })

  it('authorizes a reviewed call only for a Tier 3 connection intent, and never past Pause', () => {
    expect(authorizeDecision({ ...base, approval: undefined, review: true })).toEqual({ _tag: 'authorize', via: 'review' })
    expect(authorizeDecision({ ...base, approval: undefined, review: true, intent: { ...intent, tier: 2 } })).toEqual({ _tag: 'refused', reason: 'noApproval' })
    expect(authorizeDecision({ ...base, approval: undefined, review: true, authority: { mode: 'paused', owner: 'active' } })).toEqual({ _tag: 'refused', reason: 'paused' })
  })
})
