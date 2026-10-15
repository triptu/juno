/**
 * The owner's rules (plan v3 §9; SPEC 13.9, 13.10). Owner-only: Settings ›
 * Juno writes them, and no tool can. The model reads them with Juno's
 * instructions. A rule can only make Juno ask more: tiers, cards and grants
 * are enforced in code (`policy/`), and nothing a rule says can loosen them.
 */
import { transaction } from '../store/database'
import type { Store } from '../store/store'

export interface OwnerRule {
  readonly id: string
  readonly text: string
}

/** A rule is one line: a sentence or two. */
export const MAX_RULE_BYTES = 280
export const MAX_RULES = 20

export const ownerRules = (store: Store): ReadonlyArray<OwnerRule> =>
  store.db.prepare('SELECT id, text FROM owner_rules ORDER BY position').all() as unknown as OwnerRule[]

/** Replaces the whole list, in order. Refuses an empty, multi-line or overlong rule, or too many. */
export function setOwnerRules(store: Store, rules: ReadonlyArray<OwnerRule>): 'done' | 'invalid' {
  const clean = rules.map((rule) => ({ id: rule.id, text: rule.text.trim() }))
  const ids = new Set(clean.map((rule) => rule.id))
  if (
    clean.length > MAX_RULES || ids.size !== clean.length ||
    clean.some((rule) => rule.id === '' || rule.text === '' || rule.text.includes('\n') || Buffer.byteLength(rule.text, 'utf8') > MAX_RULE_BYTES)
  ) return 'invalid'
  transaction(store.db, () => {
    store.db.prepare('DELETE FROM owner_rules').run()
    const insert = store.db.prepare('INSERT INTO owner_rules (id, position, text, at) VALUES (?, ?, ?, ?)')
    clean.forEach((rule, position) => insert.run(rule.id, position, rule.text, store.now()))
  })
  return 'done'
}

/** The rules as the model reads them, inside Juno's instructions. */
export function rulesSection(rules: ReadonlyArray<OwnerRule>): string {
  if (rules.length === 0) return ''
  return ['The owner\'s rules. Follow them. They can make you ask first, never act without a click:', ...rules.map((rule) => `- ${rule.text}`)].join('\n')
}
