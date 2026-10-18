/**
 * Juno's memory of the owner (SPEC 13.8, "What Juno knows about you"): a
 * small fixed set of markdown docs, each a list of short entries Juno writes
 * and the owner can edit. Pure rules: entry checks, the docs as markdown,
 * search, and the short outline that goes in every chat request.
 */
import { utf8Bytes } from './tree.ts';

/** The docs, in the order the page and the outline show them. */
export const DOCS = ['you', 'people', 'projects', 'preferences', 'style'] as const;
export type Doc = (typeof DOCS)[number];

export const DOC_TITLES: Record<Doc, string> = {
  you: 'About you',
  people: 'People',
  projects: 'Projects',
  preferences: 'Preferences',
  style: 'Writing style',
};

/** What each doc holds, for the model's tool description and the page. */
export const DOC_HINTS: Record<Doc, string> = {
  you: 'who the owner is, their role and their work',
  people: 'notes about people in general; each person the owner works with has their own file',
  projects: 'projects the owner works on: what, with whom, where it stands',
  preferences: 'how the owner likes things done',
  style: "how the owner writes in Slack: tone, length, greetings, habits, words they use or avoid",
};

export const docLimits = {
  /** One entry: a line or a short paragraph. */
  entry: 600,
  /** Entries in one doc. */
  entries: 40,
  /** All docs together. */
  total: 32_768,
  /** The outline in each request. */
  outline: 1_536,
  /** One line of the outline. */
  outlineLine: 120,
  /** The person files part of the outline's People line. */
  outlinePeople: 420,
} as const;

export interface DocEntry {
  readonly id: string;
  readonly doc: Doc;
  readonly text: string;
}

export const isDoc = (value: string): value is Doc => (DOCS as ReadonlyArray<string>).includes(value);

/**
 * Shapes of keys, tokens and passwords. Juno never stores one, whoever
 * gave it. A miss here is still caught by the owner, who sees every entry.
 */
const SECRET_SHAPES: ReadonlyArray<RegExp> = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/,
  /\bsk-or-v1-[A-Za-z0-9]{16,}/,
  /\bxox[abcdeposr]-[A-Za-z0-9-]{10,}/,
  /\bxapp-[A-Za-z0-9-]{10,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b(password|passcode|passwd|pwd|api[ _-]?key|secret|token|2fa|otp|pin code)\s*(is|:|=)\s*\S+/i,
];

/** A run of 32 or more letters and digits that mixes both: likely a token. */
const LONG_TOKEN = /[A-Za-z0-9_+/=-]{32,}/g;

export function looksSecret(text: string): boolean {
  if (SECRET_SHAPES.some((shape) => shape.test(text))) return true;
  for (const match of text.matchAll(LONG_TOKEN)) {
    const word = match[0];
    if (/[0-9]/.test(word) && /[A-Za-z]/.test(word) && !/^https?/.test(word)) return true;
  }
  return false;
}

export type EntryRefusal = 'empty' | 'tooLong' | 'secret' | 'full' | 'docFull';

/** Whether `text` may be stored as an entry of `doc`, next to `others` (every entry but the one it replaces). */
export function checkEntry(doc: Doc, text: string, others: ReadonlyArray<DocEntry>): EntryRefusal | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return 'empty';
  if (utf8Bytes(trimmed) > docLimits.entry) return 'tooLong';
  if (looksSecret(trimmed)) return 'secret';
  if (others.filter((entry) => entry.doc === doc).length >= docLimits.entries) return 'docFull';
  if (others.reduce((n, entry) => n + utf8Bytes(entry.text), utf8Bytes(trimmed)) > docLimits.total) return 'full';
  return undefined;
}

/** One doc, or every doc, as markdown. Each entry carries its id so the model can change it. */
export function renderDocs(entries: ReadonlyArray<DocEntry>, only?: Doc): string {
  return DOCS.filter((doc) => only === undefined || doc === only)
    .map((doc) => {
      const own = entries.filter((entry) => entry.doc === doc);
      const body = own.length === 0 ? '(empty)' : own.map((entry) => `- [${entry.id}] ${entry.text.replace(/\n+/g, ' ')}`).join('\n');
      return `# ${DOC_TITLES[doc]} (${doc})\n${body}`;
    })
    .join('\n\n');
}

const words = (text: string): ReadonlyArray<string> => text.toLowerCase().normalize('NFKD').split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);

/**
 * Entries that share words with `query`, best first: the share of the
 * query's words an entry has, then the newest. At most `limit`.
 */
export function searchDocs(entries: ReadonlyArray<DocEntry>, query: string, limit = 12): ReadonlyArray<DocEntry> {
  const asked = [...new Set(words(query))];
  if (asked.length === 0) return [];
  const scored = entries.flatMap((entry, index) => {
    const has = new Set(words(`${DOC_TITLES[entry.doc]} ${entry.text}`));
    const hits = asked.filter((word) => has.has(word) || [...has].some((other) => other.startsWith(word))).length;
    return hits === 0 ? [] : [{ entry, score: hits / asked.length, index }];
  });
  return scored.toSorted((a, b) => b.score - a.score || b.index - a.index).slice(0, limit).map((hit) => hit.entry);
}

/** The first line of an entry, cut at a word to `max` bytes with an ellipsis. */
export function oneLiner(text: string, max: number = docLimits.outlineLine): string {
  const line = text.trim().split('\n')[0]!.replace(/^[-*#>\s]+/, '').trim();
  if (utf8Bytes(line) <= max) return line;
  let cut = '';
  for (const word of line.split(' ')) {
    const next = cut === '' ? word : `${cut} ${word}`;
    if (utf8Bytes(next) + 3 > max) break;
    cut = next;
  }
  return `${cut === '' ? [...line].slice(0, max / 4).join('') : cut}…`;
}

/**
 * The outline that goes in every chat request: each doc's title and the
 * first line of its newest entries, within `budget` bytes, with how many
 * more the full doc holds. Docs share the budget evenly; room a short doc
 * leaves goes to the others. Empty docs are named, so the model knows
 * they exist. `rev` lets the caller tell outlines apart. `files` is the
 * person files part of the People line (`peopleLine`), at most
 * `outlinePeople` bytes, which comes before the general People notes.
 */
export function outline(entries: ReadonlyArray<DocEntry>, rev: number, budget: number = docLimits.outline, files = ''): string {
  const head = `<about-owner rev="${rev}">`;
  const foot = 'Full docs: memory_read, with doc, or person for one person\'s file. Change them with memory_write.\n</about-owner>';
  let room = budget - utf8Bytes(head) - utf8Bytes(foot) - 2;
  const lines: Array<string> = [];
  DOCS.forEach((doc, index) => {
    const own = entries.filter((entry) => entry.doc === doc).toReversed();
    // The files part never takes more than half of what is left, so the outline keeps its budget.
    const lead = doc === 'people' && files !== '' && utf8Bytes(files) <= Math.min(docLimits.outlinePeople, room / 2) ? ` ${files}.` : '';
    const share = Math.floor(room / (DOCS.length - index)) + utf8Bytes(lead);
    let line = `${DOC_TITLES[doc]}:${lead}`;
    let shown = 0;
    for (const entry of own) {
      const part = `${shown === 0 ? ' ' : '; '}${oneLiner(entry.text, Math.min(docLimits.outlineLine, share))}`;
      const more = own.length - shown - 1;
      const tail = more > 0 ? ` (+${more} more)` : '';
      if (utf8Bytes(line + part + tail) > share) break;
      line += part;
      shown += 1;
    }
    if (own.length === 0 && lead === '') line += ' (empty)';
    else if (shown < own.length) line += ` (+${own.length - shown} more)`;
    lines.push(line);
    room -= utf8Bytes(line) + 1;
  });
  return [head, ...lines, foot].join('\n');
}
