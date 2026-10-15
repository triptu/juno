/**
 * The card ledger (plan v3 §6.1, §6.2, §12, §19.5; SPEC 13.3): cards Juno
 * proposed, their immutable revisions and child intents, the owner's clicks
 * and dismissals, and what the chat shows for each.
 *
 * - A proposal stores the exact payload the card renders, and one intent per
 *   child action (agent-cards `expandChildActions`). A replayed tool call
 *   finds the card it proposed.
 * - Editing a send's text appends a revision: the edited child gets a new
 *   intent revision, and the card a new revision and digest.
 * - A click approves the exact stored revision, digest and ordered children
 *   (`policy.bindingMatches`), once per card: a card runs once.
 * - Dismiss, Skip, Keep on a remove card and Wait until tomorrow decline the
 *   card. A declined, expired or settled card leaves one outcome for the
 *   model's next request (§19.5), which starts no run.
 *
 * What a card shows is derived from the ledger every time, never stored: an
 * open card expires after seven days, when the memory generation it was
 * proposed in changes (a redaction), or when a newer card replaces it.
 */
import { Schema } from 'effect'
import {
  ActionId,
  AttemptId,
  CARD_LIFETIME_MS,
  CardPayload,
  CardRecord,
  ChildEvidence,
  Digest,
  Revision,
  actionDigest,
  batchIdentity,
  canonicalPayload,
  decodePayload,
  expandChildActions,
  payloadDigest,
  toCard,
  type AttemptOutcome,
  type CardStatus,
  type ChildAction,
} from '@juno/agent-cards'
import { OpenTarget, chatCopy, type Card, type CardBinding, type CardId } from '@juno/agent-contract'
import { bindingMatches, type CardOutcome, type ChildBinding } from '../policy/policy'
import { crashPoint } from '../runtime/crash'
import { transaction } from '../store/database'
import type { Outcome } from '../store/ledger'
import { uuidv7, type Store } from '../store/store'

type Binding = typeof CardBinding.Type

export interface CardRow {
  readonly id: string
  readonly run_id: string
  readonly call_id: string
  readonly kind: string
  readonly revision: number
  readonly created_at: number
  readonly source_gen: number
  readonly dismissed_at: number | null
  readonly replaced_by: string | null
  readonly expired_at: number | null
}

export interface IntentRow {
  readonly id: string
  readonly action_id: string
  readonly rev: number
  readonly card_id: string
  readonly payload: string
  readonly digest: string
  readonly tier: 1 | 2 | 3
  readonly deduped: 0 | 1
  readonly source: number
}

export const memoryGen = (store: Store) => (store.db.prepare('SELECT gen FROM memory_head WHERE singleton = 1').get() as { gen: number }).gen

export const cardRow = (store: Store, id: string) => store.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined

export function payloadOf(store: Store, card: Pick<CardRow, 'id' | 'revision'>): CardPayload {
  const row = store.db.prepare('SELECT payload FROM card_revisions WHERE card_id = ? AND revision = ?').get(card.id, card.revision) as { payload: string }
  return decodePayload(row.payload)
}

export const intentOf = (store: Store, actionId: string, rev: number) =>
  store.db.prepare('SELECT * FROM intents WHERE action_id = ? AND rev = ?').get(actionId, rev) as IntentRow | undefined

/** The binding a click on this payload must name: the card's revision and digest, and each child in order. */
export function bindingOf(card: Pick<CardRow, 'id' | 'revision'>, payload: CardPayload): Binding {
  return {
    identity: { cardId: card.id as CardId, revision: Revision.make(card.revision), digest: payloadDigest(payload) },
    children: batchIdentity(payload).map((child) => ({ actionId: child.id, revision: child.rev, digest: child.digest })),
  }
}

/** Why an open card can no longer be clicked, or undefined while it can. */
export function expiry(store: Store, card: CardRow, now: number): 'expired' | undefined {
  if (card.expired_at !== null || card.replaced_by !== null || now >= card.created_at + CARD_LIFETIME_MS || card.source_gen !== memoryGen(store)) return 'expired'
  return undefined
}

const clicked = (store: Store, cardId: string) =>
  store.db.prepare('SELECT op_id AS opId FROM approvals WHERE card_id = ? ORDER BY at, position LIMIT 1').get(cardId) as { opId: string } | undefined

function insertRevision(store: Store, card: { id: string; revision: number }, payload: CardPayload) {
  store.db
    .prepare('INSERT INTO card_revisions (card_id, revision, payload, digest, at) VALUES (?, ?, ?, ?, ?)')
    .run(card.id, card.revision, canonicalPayload(payload), payloadDigest(payload), store.now())
  for (const child of expandChildActions(payload)) insertIntent(store, card, child)
}

function insertIntent(store: Store, card: { id: string; revision: number }, child: ChildAction) {
  store.db
    .prepare(
      `INSERT INTO intents (id, action_id, rev, card_id, card_revision, payload, digest, tier, deduped, source, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (action_id, rev) DO NOTHING`,
    )
    .run(uuidv7(store.now()), child.id, child.rev, card.id, card.revision, JSON.stringify(child.payload), actionDigest(child.payload), child.tier, child.deduped ? 1 : 0, child.source, store.now())
}

export interface Proposal {
  readonly runId: string
  /** What proposed it: a tool call id, or a run's budget ending. The same call is the same card. */
  readonly callId: string
  /** The exact payload, with ids already minted (`proposals.ts`). */
  readonly payload: CardPayload
  /** An open card this one corrects; it expires (§19.6). */
  readonly replaces?: string
}

/** Stores a proposal and its intents. Returns the card's id: the existing one for a call seen before. */
export function proposeCard(store: Store, proposal: Proposal, onProposed?: (id: string, proposal: Proposal) => void): string {
  return transaction(store.db, () => {
    const existing = store.db.prepare('SELECT id FROM cards WHERE call_id = ?').get(proposal.callId) as { id: string } | undefined
    if (existing !== undefined) return existing.id
    const id = uuidv7(store.now())
    store.db
      .prepare('INSERT INTO cards (id, run_id, call_id, kind, revision, created_at, source_gen) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .run(id, proposal.runId, proposal.callId, proposal.payload._tag, store.now(), memoryGen(store))
    insertRevision(store, { id, revision: 1 }, proposal.payload)
    onProposed?.(id, proposal)
    if (proposal.replaces !== undefined) {
      store.db.prepare('UPDATE cards SET replaced_by = ? WHERE id = ? AND replaced_by IS NULL').run(id, proposal.replaces)
    }
    return id
  })
}

export type Refused = { readonly _tag: 'refused'; readonly reason: 'stale' | 'expired' | 'invalid' }

/** The card the owner is looking at, if it is still exactly `identity` and still takes a click. */
function openCard(store: Store, identity: Binding['identity']): { card: CardRow; payload: CardPayload } | Refused {
  const card = cardRow(store, identity.cardId)
  if (card === undefined) return { _tag: 'refused', reason: 'invalid' }
  const payload = payloadOf(store, card)
  if (card.revision !== identity.revision || payloadDigest(payload) !== identity.digest) return { _tag: 'refused', reason: 'stale' }
  if (card.dismissed_at !== null || clicked(store, card.id) !== undefined || store.db.prepare('SELECT 1 FROM authorizations JOIN intents ON intents.id = authorizations.intent_id WHERE intents.card_id = ?').get(card.id) !== undefined) return { _tag: 'refused', reason: 'stale' }
  if (expiry(store, card, store.now()) !== undefined) return { _tag: 'refused', reason: 'expired' }
  return { card, payload }
}

/** Appends a revision with `payload`, and returns the card as it now is. */
function revise(store: Store, card: CardRow, payload: CardPayload) {
  const next = { id: card.id, revision: card.revision + 1 }
  store.db.prepare('UPDATE cards SET revision = ? WHERE id = ?').run(next.revision, card.id)
  insertRevision(store, next, payload)
  return bindingOf(next, payload)
}

/** "Edit" on a row of a Send message card: a new revision of that child, and of the card. */
export function editMessage(store: Store, identity: Binding['identity'], messageId: string, text: string): Binding | Refused {
  return transaction(store.db, () => {
    const open = openCard(store, identity)
    if ('_tag' in open) return open
    const { card, payload } = open
    if (payload._tag !== 'sendMessage' || !payload.messages.some((m) => m.id === messageId) || text.trim() === '') {
      return { _tag: 'refused', reason: 'invalid' } as const
    }
    const messages = payload.messages.map((m) => (m.id === messageId && m.text !== text ? { ...m, text, rev: Revision.make(m.rev + 1) } : m))
    return revise(store, card, Schema.decodeUnknownSync(CardPayload)(Schema.encodeSync(CardPayload)({ ...payload, messages })))
  })
}

/** A button's data the payload must carry before a click can approve it (`agent.cards.prepare`). */
export type Choice =
  | { readonly _tag: 'answer'; readonly answer: { readonly _tag: 'option'; readonly optionId: string } | { readonly _tag: 'text'; readonly text: string } }
  | { readonly _tag: 'schedule'; readonly action: 'keep' | 'pause' | 'delete' }
  | { readonly _tag: 'remove'; readonly alsoRemoveReply: boolean }
  | { readonly _tag: 'provider'; readonly provider: 'openrouter' | 'codex' }

/**
 * Writes a button's data into the card's one child as a new revision, so the
 * click approves exactly that answer. A choice the card does not take is
 * `invalid`.
 */
export function prepareChoice(store: Store, identity: Binding['identity'], choice: Choice): Binding | Refused {
  return transaction(store.db, () => {
    const open = openCard(store, identity)
    if ('_tag' in open) return open
    const { card, payload } = open
    const answers = (answer: Extract<Choice, { _tag: 'answer' }>['answer']) =>
      payload._tag === 'question' &&
      (answer._tag === 'text' ? payload.freeText && answer.text.trim() !== '' : payload.options.some((o) => o.id === answer.optionId))
    const takes =
      (choice._tag === 'answer' && answers(choice.answer)) ||
      (choice._tag === 'schedule' && payload._tag === 'schedule') ||
      (choice._tag === 'remove' && payload._tag === 'remove') ||
      (choice._tag === 'provider' && payload._tag === 'provider')
    if (!takes || !('action' in payload)) return { _tag: 'refused', reason: 'invalid' } as const
    const { _tag: _, ...data } = choice
    const args = payload.action.payload.args
    const action = {
      ...payload.action,
      rev: Revision.make(payload.action.rev + 1),
      payload: { ...payload.action.payload, args: { ...(typeof args === 'object' && args !== null && !Array.isArray(args) ? args : {}), choice: data } },
    }
    return revise(store, card, Schema.decodeUnknownSync(CardPayload)(Schema.encodeSync(CardPayload)({ ...payload, action } as CardPayload)))
  })
}

/**
 * The owner's click (spec `click`, `clickBatch`): one approval per child of
 * the exact stored revision, in order, under the click's op id. The same op
 * again is the same click. A card takes one click.
 */
export function recordClick(store: Store, opId: string, identity: Binding['identity'], children: ReadonlyArray<ChildBinding>): { readonly _tag: 'accepted' } | Refused {
  const result = clickOnce(store, opId, identity, children)
  if (result._tag === 'accepted') crashPoint('approval.committed')
  return result
}

function clickOnce(store: Store, opId: string, identity: Binding['identity'], children: ReadonlyArray<ChildBinding>): { readonly _tag: 'accepted' } | Refused {
  return transaction(store.db, () => {
    const seen = store.db.prepare('SELECT card_id AS cardId FROM approvals WHERE op_id = ? LIMIT 1').get(opId) as { cardId: string } | undefined
    if (seen !== undefined) return seen.cardId === identity.cardId ? { _tag: 'accepted' as const } : { _tag: 'refused' as const, reason: 'invalid' as const }
    const open = openCard(store, identity)
    if ('_tag' in open) return open
    const stored = bindingOf(open.card, open.payload)
    if (stored.children.length === 0) return { _tag: 'refused', reason: 'invalid' } as const
    if (!bindingMatches({ ...stored.identity, children: stored.children }, { ...identity, children })) return { _tag: 'refused', reason: 'stale' } as const
    stored.children.forEach((child, position) => {
      const intent = intentOf(store, child.actionId, child.revision)!
      store.db
        .prepare('INSERT INTO approvals (id, op_id, card_id, card_revision, intent_id, position, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uuidv7(store.now()), opId, open.card.id, open.card.revision, intent.id, position, store.now())
    })
    return { _tag: 'accepted' as const }
  })
}

/** Dismiss, Skip, Keep on a remove card, Wait until tomorrow: a no (§19.5). Starts no run. */
export function dismiss(store: Store, identity: Binding['identity']): { readonly _tag: 'accepted' } | Refused {
  return transaction(store.db, () => {
    const card = cardRow(store, identity.cardId)
    if (card?.dismissed_at != null) return { _tag: 'accepted' as const }
    const open = openCard(store, identity)
    if ('_tag' in open) return open
    store.db.prepare('UPDATE cards SET dismissed_at = ? WHERE id = ?').run(store.now(), open.card.id)
    recordOutcome(store, open.card.id, 'declined', summaryOf(open.payload))
    return { _tag: 'accepted' as const }
  })
}

/** Keeps the first outcome of a card; a later positive receipt turns `failed` into `done` until the model has read it. */
export function recordOutcome(store: Store, cardId: string, outcome: CardOutcome, summary: string): void {
  store.db
    .prepare(
      `INSERT INTO card_outcomes (card_id, outcome, summary, at) VALUES (?, ?, ?, ?)
       ON CONFLICT (card_id) DO UPDATE SET outcome = excluded.outcome, at = excluded.at
       WHERE card_outcomes.carried_by IS NULL AND card_outcomes.outcome = 'failed' AND excluded.outcome = 'done'`,
    )
    .run(cardId, outcome, summary, store.now())
}

/** Text inside a tag the model reads: escaped, so stored text can never close the tag or open another. */
const escaped = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/**
 * The card outcomes the model has not read yet, as lines for the next input
 * `opId` delivers (§19.5): `<card-outcome card="…" kind="…" outcome="declined">summary</card-outcome>`.
 * Open cards past their expiry are recorded first. The same op gets the
 * same lines if it is delivered again.
 */
export function carryOutcomes(store: Store, opId: string): string {
  return transaction(store.db, () => {
    const now = store.now()
    const open = store.db
      .prepare(
        `SELECT * FROM cards WHERE dismissed_at IS NULL AND kind NOT IN ('topics', 'task')
         AND NOT EXISTS (SELECT 1 FROM approvals WHERE approvals.card_id = cards.id)
         AND NOT EXISTS (SELECT 1 FROM card_outcomes WHERE card_outcomes.card_id = cards.id)`,
      )
      .all() as unknown as CardRow[]
    for (const card of open) if (expiry(store, card, now) !== undefined) recordOutcome(store, card.id, 'expired', summaryOf(payloadOf(store, card)))
    store.db.prepare('UPDATE card_outcomes SET carried_by = ? WHERE carried_by IS NULL').run(opId)
    const rows = store.db
      .prepare('SELECT card_outcomes.card_id AS id, cards.kind, outcome, summary FROM card_outcomes JOIN cards ON cards.id = card_outcomes.card_id WHERE carried_by = ? ORDER BY at, card_id')
      .all(opId) as Array<{ id: string; kind: string; outcome: CardOutcome; summary: string }>
    return rows.map((row) => `<card-outcome card="${row.id}" kind="${row.kind}" outcome="${row.outcome}">${escaped(row.summary)}</card-outcome>`).join('\n')
  })
}

/** One line on what a card asks, for the model: its outcome, or the quote in a reply to it. Rendered from the stored payload. */
export function summaryOf(payload: CardPayload): string {
  switch (payload._tag) {
    case 'sendMessage':
      return payload.messages.map((m) => `Send to ${m.target.name}${m.inTopic ? ` in ${m.inTopic.title}` : ''}: ${m.text}`).join('\n')
    case 'resolve':
      return `Resolve ${payload.topics.map((t) => t.title).join(', ')}`
    case 'topics':
      return `Topics: ${payload.links.map((t) => t.title).join(', ')}`
    case 'proposedTask':
      return `Start ${payload.kind === 't3' ? 'a T3 Code task' : 'a task'}: ${payload.title} (${payload.where})`
    case 'task':
      return `Task: ${payload.title}`
    case 'question':
      return `${payload.prompt} Options: ${payload.options.map((o) => o.label).join(', ')}`
    case 'proposedSchedule':
      return `Schedule ${payload.what}, ${payload.when}: ${payload.prompt}`
    case 'schedule':
      return `Schedule ${payload.what}, ${payload.when}`
    case 'connect':
      return `Connect ${payload.server}`
    case 'change':
      return `Change ${payload.target} on ${payload.server}${payload.caption ? `: ${payload.caption}` : ''}`
    case 'remove':
      return `Remove ${payload.messages.length} messages`
    case 'budget':
      return 'Allow $1 more today'
    case 'provider':
      return 'Choose a model provider'
  }
}

/** A reply's quote of a card: what it asks, from the stored payload (§8, O7). */
export function quoteOf(store: Store, cardId: string): string | undefined {
  const card = cardRow(store, cardId)
  return card === undefined ? undefined : `<quote card="${card.id}" kind="${card.kind}">${escaped(summaryOf(payloadOf(store, card)))}</quote>`
}

/** Refusals at dispatch that mean the card expired under the click, not that it failed. */
const EXPIRY = new Set(['expired', 'stale', 'sourceChanged'])

const expiredUnderClick = (store: Store, cardId: string) =>
  (store.db.prepare('SELECT refused FROM approvals WHERE card_id = ? AND refused IS NOT NULL').all(cardId) as Array<{ refused: string }>).some((row) => EXPIRY.has(row.refused))

const evidenceOutcome: Record<Outcome, AttemptOutcome> = {
  consumed: 'consumed', sent: 'submitted', 'cancel-requested': 'cancel-requested', cancelled: 'cancelled', unknown: 'unknown', done: 'done', failed: 'failed',
}

/**
 * Each authorization of an intent as agent-cards evidence: one attempt each,
 * the record's outcome. A child the dispatcher refused never ran: its row
 * reads failed, unless nothing on the card ran and the refusal was an
 * expiry (`expiryShowsExpired`), in which case the card reads Expired.
 */
function evidence(store: Store, intent: IntentRow, expiryShowsExpired: boolean): ChildEvidence {
  const auths = store.db
    .prepare(
      `SELECT authorizations.id, authorizations.outcome, attempts.id AS attempt FROM authorizations
       LEFT JOIN attempts ON attempts.authorization_id = authorizations.id WHERE intent_id = ? ORDER BY consumed_at, authorizations.id`,
    )
    .all(intent.id) as Array<{ id: string; outcome: Outcome; attempt: string | null }>
  const refused = store.db.prepare('SELECT refused FROM approvals WHERE intent_id = ? AND refused IS NOT NULL').get(intent.id) as { refused: string } | undefined
  return {
    id: ActionId.make(intent.action_id),
    rev: Revision.make(intent.rev),
    digest: Digest.make(intent.digest),
    attempts: [
      ...auths.map((a) => ({ id: AttemptId.make(a.attempt ?? a.id), outcome: evidenceOutcome[a.outcome] })),
      ...(refused !== undefined && auths.length === 0 && !(expiryShowsExpired && EXPIRY.has(refused.refused))
        ? [{ id: AttemptId.make(`refused:${intent.id}`), outcome: 'cancelled' as const }]
        : []),
    ],
  }
}

/** The "done" line of a settled card (chatCopy), from its stored payload and the receipt. */
function doneLine(payload: CardPayload, receipt: unknown): { readonly line: string; readonly open?: OpenTarget } {
  const copy = chatCopy.card
  const args = 'action' in payload ? (payload.action.payload.args as { choice?: Record<string, unknown> } | null) : undefined
  const choice = args?.choice
  switch (payload._tag) {
    case 'resolve':
      return { line: copy.resolve.resolved(payload.topics.length) }
    case 'proposedTask':
      return { line: copy.task.started }
    case 'question': {
      const answer = choice?.answer as { _tag: 'option'; optionId: string } | { _tag: 'text' } | undefined
      const option = answer?._tag === 'option' ? payload.options.find((o) => o.id === answer.optionId) : undefined
      return { line: option ? copy.question.chose(option.label) : copy.question.replied }
    }
    case 'proposedSchedule':
      return { line: copy.schedule.started }
    case 'schedule': {
      const action = choice?.action
      return { line: action === 'pause' ? copy.schedule.paused : action === 'delete' ? copy.schedule.deleted : copy.schedule.kept }
    }
    case 'connect':
      return { line: copy.connect.connected }
    case 'change': {
      const open = (receipt as { open?: unknown } | null)?.open
      return Schema.is(OpenTarget)(open) ? { line: copy.change.applied, open } : { line: copy.change.applied }
    }
    case 'remove':
      return { line: copy.remove.removed(payload.messages.length) }
    case 'budget':
      return { line: copy.budget.allowed }
    case 'provider':
      return { line: copy.provider.using(String((receipt as { model?: unknown } | null)?.model ?? '')) }
    case 'sendMessage':
    case 'topics':
    case 'task':
      return { line: '' }
  }
}

export interface CardView {
  readonly runId: string
  readonly at: number
  readonly card: Card
  /** Present while the card takes a click. */
  readonly binding?: Binding
}

/**
 * A card as the chat shows it (agent-cards `toCard`), with the binding a
 * click must return while it is open.
 */
export function viewOf(store: Store, card: CardRow, now: number): CardView {
  const payload = payloadOf(store, card)
  const children = expandChildActions(payload)
  const intents = children.map((child) => intentOf(store, child.id, child.rev)!)
  const approved = clicked(store, card.id) !== undefined
  const ran = intents.some((intent) => store.db.prepare('SELECT 1 FROM authorizations WHERE intent_id = ?').get(intent.id) !== undefined)
  const evidences = intents.map((intent) => evidence(store, intent, !ran))
  const sourceValid = card.expired_at === null && card.replaced_by === null && card.source_gen === memoryGen(store)
  const base = { id: card.id as CardId, createdAt: card.created_at, sourceValid }
  let record: CardRecord
  if (payload._tag === 'sendMessage') {
    const status: CardStatus =
      card.dismissed_at !== null ? { _tag: 'dismissed' } : !approved ? { _tag: 'open' } : expiredUnderClick(store, card.id) ? { _tag: 'expired' } : { _tag: 'working' }
    record = { ...base, payload, status, children: evidences }
  } else if (payload._tag === 'task') {
    throw new Error('task cards are listed from jobs')
  } else {
    record = { ...base, payload, status: statusOf(store, card, payload, evidences, approved || ran) } as CardRecord
  }
  const view = toCard(record, now)
  const binding = view._tag !== 'unknown' && 'status' in view && view.status._tag === 'open' && children.length > 0 ? bindingOf(card, payload) : undefined
  return { runId: card.run_id, at: card.created_at, card: view, ...(binding ? { binding } : {}) }
}

function statusOf(store: Store, card: CardRow, payload: CardPayload, evidences: ReadonlyArray<ChildEvidence>, approved: boolean): CardStatus {
  if (card.dismissed_at !== null) return { _tag: 'dismissed' }
  if (!approved) return { _tag: 'open' }
  if (expiredUnderClick(store, card.id)) return { _tag: 'expired' }
  const outcomes = evidences.map((e) => (e.attempts.some((a) => a.outcome === 'done') ? 'done' : e.attempts.some((a) => a.outcome === 'consumed' || a.outcome === 'submitted' || a.outcome === 'cancel-requested') || e.attempts.length === 0 ? 'working' : 'failed'))
  if (outcomes.every((o) => o === 'done')) {
    const receipt = receiptOf(store, evidences[0])
    return { _tag: 'done', ...doneLine(payload, receipt) }
  }
  if (outcomes.includes('working')) return { _tag: 'working' }
  return { _tag: 'failed', line: chatCopy.card.failed }
}

function receiptOf(store: Store, child: ChildEvidence | undefined): unknown {
  const done = child?.attempts.find((a) => a.outcome === 'done')
  if (done === undefined) return undefined
  const row = store.db.prepare('SELECT evidence FROM receipts WHERE attempt_id = ?').get(done.id) as { evidence: string } | undefined
  return row === undefined ? undefined : JSON.parse(row.evidence)
}

/** Records the card's outcome for the model once every child has settled (§19.5). */
export function settleCardOutcome(store: Store, cardId: string): void {
  const card = cardRow(store, cardId)
  if (card === undefined) return
  const view = viewOf(store, card, store.now()).card
  if (!('status' in view)) return
  const status = view.status._tag
  if (status !== 'done' && status !== 'failed' && status !== 'expired') return
  transaction(store.db, () => recordOutcome(store, cardId, status, summaryOf(payloadOf(store, card))))
}

/** Every card Juno proposed, oldest first, as the chat shows it. */
export function cardViews(store: Store, now: number): ReadonlyArray<CardView> {
  const rows = store.db.prepare("SELECT * FROM cards WHERE kind != 'task' ORDER BY created_at, id").all() as unknown as CardRow[]
  return rows.map((row) => viewOf(store, row, now))
}
