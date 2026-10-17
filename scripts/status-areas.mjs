// Areas of work for the status page. Each pattern is matched against an item's
// author (an agent's branch name, like `home-review-2` or `ci-fix-22`, worth 3
// hits) and its text (1 per hit). An item gets its best-scoring areas, up to 3,
// that score at least half of the best. Items that match nothing are "Other".
// Edit this table to retune the tags; its order is the order of the chips.

export const areas = [
  ['Home', /\bhome\b|new chat|newchat|⌘N|\brecents?\b|destination/gi],
  ['Sidebar', /sidebar|avatar stack|row footer|\bautomated\b|dm-rows/gi],
  ['Composer', /composer|draft|textarea|grammar|send checks?|attach|upload|paste|emoji|mention|link editor/gi],
  ['Topics/messages', /\btopics?\b|thread|message (?:row|list|toolbar|text|header)|reactions?|reactors|unfurl|\bpeek|toolbar|\bMain\b|follow|usergroup/gi],
  ['Tabs/window', /\btabs?\b|⌘T|⌘W|title ?bar|full-?screen|window|palette|⌘K/gi],
  ['Juno agent', /juno panel|juno tab|juno-panel|⌘J|ask juno|to juno|codex|connection tools?|auto-review|\bAI\b|ai-audit|codemode|juno-markdown|recovery phrase/gi],
  ['Sync', /\bsync|engine|outbox|read state|follow state|\bcache|history|offline|rate limit|\/min\b|per minute|quint|slack calls?/gi],
  ['Settings/privacy', /settings|privacy|keychain|notifications?|\bdnd\b|presence|onboarding|slack import|screen-share/gi],
  ['Perf', /\bperf|budget|p95|\d ?ms\b|frames?\b|bundle|lazy|startup|idle|scroll|\bKB\b|bun check/gi],
  ['Tests/CI', /\btests?\b|spec\.ts|\be2e\b|gallery|flak|ci-fix|ci keeper|ci-keeper|verify:main|\blint\b|typecheck|vitest|playwright|shift guard|affected|test-/gi],
  ['Remote pool', /remote|\bpool\b|namespace|\bnsc\b|machines?\b|8x16|runner/gi],
  ['Design system', /design tokens?|@juno\/tokens|primitive|stylex|\bicons?\b|duotone|\bfonts?\b|colou?rs?\b|dark mode|focus rings?|tooltip|popover|motion|animation|design review/gi],
  ['Docs', /\bdocs?\/|readme|decision log|SPEC\.md|\bADR\b|\.md\b/gi],
]

const hits = (pattern, text) => (text ? (text.match(pattern) ?? []).length : 0)

// Areas for an item, best first.
export const tag = (author, ...texts) => {
  const text = texts.filter(Boolean).join(' ')
  const scored = areas
    .map(([name, pattern]) => [name, hits(pattern, author) * 3 + hits(pattern, text)])
    .filter(([, score]) => score > 0)
    .toSorted((a, b) => b[1] - a[1])
  if (!scored.length) return ['Other']
  return scored.filter(([, score]) => score * 2 >= scored[0][1]).slice(0, 3).map(([name]) => name)
}
