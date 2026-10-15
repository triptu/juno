/**
 * The action policy (plan v3 §6, §9, §19.4; SPEC 13.3, 13.9). Pure rules,
 * no I/O: the ledger gathers the facts, these functions decide, and the
 * ledger commits the decision in the same transaction.
 *
 * Each rule is the guard of a transition in `specs/agent-actions.qnt`:
 *
 * - `authorizeDecision` is `authorizeWith` with no bug enabled: a current,
 *   valid intent; an exact, unused approval (or a live grant for Tier 2 in
 *   a clean owner run); never a second authorization of a child that does
 *   not deduplicate (`noRepeatAuthorization`); never Tier 4; never while
 *   paused, off or not the owner (`pauseBlocksAuthorization`).
 * - `toolDecision` is the tier table (§9) with the clean-run rule (§6.4):
 *   untrusted content in the run turns a no-click call into a card.
 * - `mayMintGrant` is `grantWith`, `grantClick`, `scheduleFromClick` and
 *   `scheduleFromMenu`: the three owner authorities (`untrustedCannotGrant`).
 */

export type Mode = 'on' | 'paused' | 'off'
export type OwnerState = 'active' | 'released' | 'recovery'

/** Whether this Mac may authorize anything now (spec `mayAuthorize`). */
export interface Authority {
  readonly mode: Mode
  readonly owner: OwnerState
}

export const mayAuthorize = (authority: Authority): boolean => authority.mode === 'on' && authority.owner === 'active'

/** Why an intent can no longer run as approved (spec `valid`). */
export type Invalid = 'stale' | 'expired' | 'sourceChanged' | 'schemaChanged' | 'accountChanged' | 'connectionChanged' | 'preconditionFailed'

export interface AuthorizeInput {
  readonly authority: Authority
  /** The child intent the dispatcher is about to authorize. */
  readonly intent: {
    readonly rev: number
    readonly digest: string
    readonly tier: 1 | 2 | 3 | 4
    readonly deduped: boolean
  }
  /** Its validity now: `valid`, or the first reason it is not. `stale` means a newer revision exists. */
  readonly validity: 'valid' | Invalid
  /** The owner's click on this child, if any. `batchOrdered`: the batch it came in matches the stored order. */
  readonly approval?: { readonly rev: number; readonly digest: string; readonly used: boolean; readonly batchOrdered: boolean }
  /** A live grant for this target exists and the run asking is a clean owner run. */
  readonly grant: boolean
  /** Digests of every earlier authorization of this child, whatever their outcome. */
  readonly prior: ReadonlyArray<string>
  /** A receipt already proves the child happened. */
  readonly done: boolean
}

export type Refusal =
  | { readonly _tag: 'refused'; readonly reason: 'paused' | 'off' | 'notOwner' }
  | { readonly _tag: 'refused'; readonly reason: 'invalid'; readonly invalid: Invalid }
  | { readonly _tag: 'refused'; readonly reason: 'destructive' | 'done' | 'alreadyAuthorized' | 'payloadChanged' | 'noApproval' }

export type AuthorizeDecision = { readonly _tag: 'authorize'; readonly via: 'approval' | 'grant' } | Refusal

export function authorizeDecision(input: AuthorizeInput): AuthorizeDecision {
  const { authority, intent } = input
  if (authority.owner !== 'active') return { _tag: 'refused', reason: 'notOwner' }
  if (authority.mode !== 'on') return { _tag: 'refused', reason: authority.mode }
  if (intent.tier === 4) return { _tag: 'refused', reason: 'destructive' }
  if (input.validity !== 'valid') return { _tag: 'refused', reason: 'invalid', invalid: input.validity }
  if (input.done) return { _tag: 'refused', reason: 'done' }
  // A card runs once (O2): a destination that does not deduplicate gets one authorization, whatever became of it.
  if (input.prior.length > 0 && !intent.deduped) return { _tag: 'refused', reason: 'alreadyAuthorized' }
  // A deduplicated child may be authorized again only under the same key and payload.
  if (input.prior.some((digest) => digest !== intent.digest)) return { _tag: 'refused', reason: 'payloadChanged' }
  const approval = input.approval
  if (approval !== undefined && !approval.used && approval.batchOrdered && approval.rev === intent.rev && approval.digest === intent.digest) {
    return { _tag: 'authorize', via: 'approval' }
  }
  if (input.grant && intent.tier === 2) return { _tag: 'authorize', via: 'grant' }
  return { _tag: 'refused', reason: 'noApproval' }
}

/** Who started the run, and whether it has read untrusted content yet (§6.4). */
export interface RunFacts {
  readonly origin: 'owner' | 'wake' | 'report' | 'click'
  readonly clean: boolean
}

/**
 * What a tool call does to the outside, by the tier table (§9, SPEC 13.9).
 *
 * - `read`: Tier 0 lookups.
 * - `local`: Tier 1 that needs no conversation authority (`remember` from the owner's words, `notify`).
 * - `scheduleCreate`, `notificationsSet`: Tier 1 only from a clean owner run (§11.1, §19.4).
 * - `ownSchedule`: pause or delete of the schedule that woke this run.
 * - `t3Start`: always a Proposed task card (O3).
 * - `delegateSpawn`: Tier 2, no click in a clean owner run.
 * - `steer`, `stopJob`: `t3_send`, `delegate.message`; `t3_stop`, `delegate.stop`. No click under a live grant.
 * - `outward`: Tier 3. A card every time.
 * - `destructive`: Tier 4. Never offered.
 */
export type OpClass =
  | 'read' | 'local' | 'scheduleCreate' | 'notificationsSet' | 'ownSchedule'
  | 't3Start' | 'delegateSpawn' | 'steer' | 'stopJob' | 'outward' | 'destructive'

export type ToolDecision =
  /** Run it now, with no click. */
  | { readonly _tag: 'run' }
  /** Propose a card instead. `because`: untrusted content is why it is a card (the Because line). */
  | { readonly _tag: 'card'; readonly because: boolean }
  | { readonly _tag: 'refused'; readonly reason: 'notOwnerRun' | 'useTaskCard' | 'destructive' | 'notOwnSchedule' }

export interface ToolFacts {
  /** A live grant covers the job this call names (steer, stopJob). */
  readonly liveGrant?: boolean
  /** The schedule named is the one that woke this run (ownSchedule). */
  readonly wokeThisRun?: boolean
}

const cleanOwner = (run: RunFacts) => run.origin === 'owner' && run.clean

export function toolDecision(op: OpClass, run: RunFacts, facts: ToolFacts = {}): ToolDecision {
  switch (op) {
    case 'read':
    case 'local':
      return { _tag: 'run' }
    case 'scheduleCreate':
    case 'notificationsSet':
      if (cleanOwner(run)) return { _tag: 'run' }
      // Wake and report runs get neither path (§11.1).
      return run.origin === 'owner' ? { _tag: 'card', because: true } : { _tag: 'refused', reason: 'notOwnerRun' }
    case 'ownSchedule':
      return facts.wokeThisRun === true || cleanOwner(run) ? { _tag: 'run' } : { _tag: 'refused', reason: 'notOwnSchedule' }
    case 't3Start':
      return { _tag: 'card', because: !run.clean }
    case 'delegateSpawn':
      return cleanOwner(run) ? { _tag: 'run' } : { _tag: 'card', because: true }
    case 'steer':
      return cleanOwner(run) && facts.liveGrant === true ? { _tag: 'run' } : { _tag: 'card', because: true }
    case 'stopJob':
      // The Task card's Stop is the owner's click (W10); no card is proposed for it.
      return cleanOwner(run) && facts.liveGrant === true ? { _tag: 'run' } : { _tag: 'refused', reason: 'useTaskCard' }
    case 'outward':
      return { _tag: 'card', because: false }
    case 'destructive':
      return { _tag: 'refused', reason: 'destructive' }
  }
}

/**
 * The three owner authorities that may mint a grant (§6.4, §11.1, §19.2):
 *
 * - `cleanRun`: a no-click call in an owner run that has read nothing untrusted, whose source op is in that run.
 * - `click`: the owner's click on a card whose stored revision and digest are still current.
 * - `menu`: "Tell me if nobody replies" in a message's menu; nothing about any run matters.
 *
 * Each needs this Mac to be able to authorize: a paused, off or non-owning Juno mints nothing.
 * Reports, tool output, wakes and steering are never an authority.
 */
export type GrantAuthority =
  | { readonly _tag: 'cleanRun'; readonly run: RunFacts; readonly sourceInRun: boolean }
  | { readonly _tag: 'click'; readonly current: boolean }
  | { readonly _tag: 'menu' }

export function mayMintGrant(authority: GrantAuthority, now: Authority): boolean {
  if (!mayAuthorize(now)) return false
  switch (authority._tag) {
    case 'cleanRun':
      return cleanOwner(authority.run) && authority.sourceInRun
    case 'click':
      return authority.current
    case 'menu':
      return true
  }
}

/** One child as a click binds it (agent-contract `ChildApproval`). */
export interface ChildBinding {
  readonly actionId: string
  readonly revision: number
  readonly digest: string
}

/**
 * A click approves the exact stored card: its revision and digest, and every
 * child in the stored order with its revision and executable digest. Anything
 * else is a click on something the owner no longer sees (`stale`).
 */
export function bindingMatches(
  stored: { readonly revision: number; readonly digest: string; readonly children: ReadonlyArray<ChildBinding> },
  clicked: { readonly revision: number; readonly digest: string; readonly children: ReadonlyArray<ChildBinding> },
): boolean {
  return (
    stored.revision === clicked.revision &&
    stored.digest === clicked.digest &&
    stored.children.length === clicked.children.length &&
    stored.children.every((child, i) => {
      const other = clicked.children[i]
      return other !== undefined && other.actionId === child.actionId && other.revision === child.revision && other.digest === child.digest
    })
  )
}

/**
 * What the model's next request is told about a settled card (§19.5). A
 * dismissal and an expiry say no; the model also learns a click's result,
 * so it neither proposes a sent message again nor claims a failed one
 * landed. Juno-internal state: it never taints a run.
 */
export type CardOutcome = 'declined' | 'expired' | 'done' | 'failed'
