/**
 * Juno's file on each person the owner works with (SPEC 13.8, "People you
 * work with"): one file per Slack user id, in four short sections. Pure
 * rules: who gets a file, what an entry may hold, the file as text, the
 * People line of the outline, the people a run involves, and the split of
 * the older single People doc into files.
 */
import { utf8Bytes } from './tree.ts';
import { docLimits, looksSecret, oneLiner, type DocEntry } from './docs.ts';

/** A file's sections, in the order the page and the model read them. */
export const SECTIONS = ['role', 'work', 'talk', 'notes'] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_TITLES: Record<Section, string> = {
  role: 'Who they are to you',
  work: 'What they work on',
  talk: 'How you talk with them',
  notes: 'Notes',
};

/** What each section holds, for the model's tool description. */
export const SECTION_HINTS: Record<Section, string> = {
  role: 'who they are to the owner and how they work together',
  work: 'their projects, areas and current threads',
  talk: 'how the owner talks with them: tone, formality, language, length, how fast they reply, harmless inside jokes',
  notes: 'their preferences, working hours or timezone, what they care about',
};

export const RELATIONSHIPS = ['manager', 'report', 'peer', 'skip', 'crossTeam', 'external', 'customer'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  manager: 'Manager',
  report: 'Direct report',
  peer: 'Peer',
  skip: 'Skip-level',
  crossTeam: 'Cross-team',
  external: 'External',
  customer: 'Customer',
};

export const isSection = (value: string): value is Section => (SECTIONS as ReadonlyArray<string>).includes(value);
export const isRelationship = (value: string): value is Relationship => (RELATIONSHIPS as ReadonlyArray<string>).includes(value);

const DAY = 24 * 60 * 60 * 1000;

export const peopleLimits = {
  /** How far back interactions count. */
  windowMs: 60 * DAY,
  /** Messages exchanged in that window, both sides together, before Juno keeps a file on its own. */
  minMessages: 4,
  /** Entries in one section of a file. */
  sectionEntries: 6,
  /** All of one file's entries together. */
  file: 3_072,
  /** Files Juno keeps. */
  files: 200,
  /** People the outline names. */
  outlineTop: 10,
  /** Files one run's context carries, and their bytes together. */
  contextFiles: 3,
  contextBytes: 6_144,
  /** A background update of one file, at most this often. */
  refreshMs: DAY,
} as const;

/* Who gets a file ----------------------------------------------------------- */

/** What the owner and one person exchanged in DMs and threads in the window. `lastAt` is the newest message, in ms. */
export interface Interaction {
  readonly id: string;
  readonly name: string;
  /** The owner's messages to them. */
  readonly owner: number;
  /** Their messages to the owner. */
  readonly them: number;
  readonly lastAt: number;
}

export const exchanged = (interaction: Interaction): number => interaction.owner + interaction.them;

/** Whether Juno keeps a file on this person without being asked: a real exchange, both ways, recently. */
export function qualifies(interaction: Interaction, now: number): boolean {
  return interaction.owner >= 1 && interaction.them >= 1 && exchanged(interaction) >= peopleLimits.minMessages && now - interaction.lastAt <= peopleLimits.windowMs;
}

/**
 * Whether a file on this person may exist: the owner asked (their own words,
 * or the memory page), or they qualify by interaction. Nobody else gets one.
 */
export function mayKeepFile(input: { readonly asked: boolean; readonly interaction: Interaction | undefined; readonly now: number }): boolean {
  return input.asked || (input.interaction !== undefined && qualifies(input.interaction, input.now));
}

/** Most exchanged first, then the most recent, then by id so the order is stable. */
export function rankPeople<T extends Interaction>(people: ReadonlyArray<T>): ReadonlyArray<T> {
  return people.toSorted((a, b) => exchanged(b) - exchanged(a) || b.lastAt - a.lastAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Whether a background update of a file is due: they qualify, and something
 * was exchanged since the last update, which was at least a day ago.
 */
export function dueForUpdate(interaction: Interaction, learnedAt: number | undefined, now: number): boolean {
  if (!qualifies(interaction, now)) return false;
  if (learnedAt === undefined) return true;
  return now - learnedAt >= peopleLimits.refreshMs && interaction.lastAt > learnedAt;
}

/* What an entry may hold ---------------------------------------------------- */

export type Sensitive = 'health' | 'money' | 'family' | 'performance' | 'beliefs' | 'legal' | 'contact';

/**
 * Details about a person Juno never writes unless the owner said them
 * (SPEC 13.8 and the privacy rule for titles). A miss here is still caught
 * by the owner, who sees every entry; the prompt asks the model the same.
 */
const SENSITIVE: ReadonlyArray<readonly [Sensitive, RegExp]> = [
  ['health', /\b(sick|illness|ill|diagnos\w*|surgery|hospital\w*|medical|medication|therap(?:y|ist)|mental health|depress\w*|anxiety|cancer|disabilit\w*|pregnan\w*|sick leave|chronic)\b/i],
  ['money', /\b(salary|salaries|compensation|pay (?:rise|raise|cut|band|grade)|got a raise|bonus|equity (?:grant|package)|stock options|payroll|debt|loan|mortgage|bankrupt\w*)\b/i],
  ['family', /\b(divorc\w*|wife|husband|spouse|kids?|children|son|daughter|bab(?:y|ies)|newborn|maternity|paternity|parental leave|custody|family (?:emergency|issues?|matters?))\b/i],
  ['performance', /\b(underperform\w*|performance (?:reviews?|issues?|problems?|plan|concerns?)|PIP|improvement plan|fired|firing|let go|laid off|layoffs?|terminat\w*|promo(?:tion)? packet|promotion case|disciplin\w*|lazy|incompetent|(?:weak|low|poor) performer)\b/i],
  ['beliefs', /\b(religio\w*|church|mosque|synagogue|political views|votes? for|sexual orientation)\b/i],
  ['legal', /\b(lawsuit|sued|suing|arrest\w*|criminal|visa status|immigration status|legal (?:action|case|trouble))\b/i],
  ['contact', /(\b[\w.+-]+@[\w-]+\.[\w.-]+\b|(?:\+\d{1,3}[ .-]?)?\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b|\bhome address\b|\blives at\b)/i],
];

export function sensitiveKind(text: string): Sensitive | undefined {
  return SENSITIVE.find(([, shape]) => shape.test(text))?.[0];
}

export interface PersonEntry {
  readonly id: string;
  readonly section: Section;
  readonly text: string;
}

export type PersonRefusal = 'empty' | 'tooLong' | 'secret' | 'sensitive' | 'sectionFull' | 'fileFull';

/**
 * Whether `text` may be stored in `section` of a file, next to `others` (the
 * file's other entries). `ownerWords`: the owner said it themselves, in a
 * clean run or on the memory page; only then may it hold a sensitive detail.
 */
export function checkPersonEntry(section: Section, text: string, others: ReadonlyArray<PersonEntry>, options: { readonly ownerWords: boolean }): PersonRefusal | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return 'empty';
  if (utf8Bytes(trimmed) > docLimits.entry) return 'tooLong';
  if (looksSecret(trimmed)) return 'secret';
  if (!options.ownerWords && sensitiveKind(trimmed) !== undefined) return 'sensitive';
  if (others.filter((entry) => entry.section === section).length >= peopleLimits.sectionEntries) return 'sectionFull';
  if (others.reduce((n, entry) => n + utf8Bytes(entry.text), utf8Bytes(trimmed)) > peopleLimits.file) return 'fileFull';
  return undefined;
}

/* The file as text ---------------------------------------------------------- */

export interface PersonFile {
  readonly id: string;
  readonly name: string;
  readonly relationship?: Relationship;
  /** Who set the relationship: the owner, or Juno's guess. */
  readonly relationshipBy?: 'juno' | 'owner';
  readonly entries: ReadonlyArray<PersonEntry>;
}

const relationshipText = (file: PersonFile): string =>
  file.relationship === undefined ? 'not known' : `${RELATIONSHIP_LABELS[file.relationship]} (${file.relationshipBy === 'owner' ? 'set by the owner' : 'your guess'})`;

/** One file as markdown. Each entry carries its id so the model can change it. */
export function renderPerson(file: PersonFile): string {
  const sections = SECTIONS.map((section) => {
    const own = file.entries.filter((entry) => entry.section === section);
    const body = own.length === 0 ? '(empty)' : own.map((entry) => `- [${entry.id}] ${entry.text.replace(/\n+/g, ' ')}`).join('\n');
    return `${SECTION_TITLES[section]} (${section}):\n${body}`;
  });
  return [`## ${file.name} (${file.id})`, `Relationship: ${relationshipText(file)}`, ...sections].join('\n');
}

/**
 * The files a run involves, for its context after the cached prefix: in
 * the order given, at most `contextFiles` of them and `contextBytes`
 * together. A file that does not fit is named, so the model can read it.
 */
export function peopleContext(files: ReadonlyArray<PersonFile>): string {
  if (files.length === 0) return '';
  const head = '<people-now>';
  const foot = '</people-now>';
  let room = peopleLimits.contextBytes - utf8Bytes(head) - utf8Bytes(foot) - 2;
  const parts: Array<string> = [];
  const skipped: Array<string> = [];
  for (const file of files.slice(0, peopleLimits.contextFiles)) {
    const text = renderPerson(file);
    if (utf8Bytes(text) + 1 > room) skipped.push(`${file.name} (${file.id})`);
    else {
      parts.push(text);
      room -= utf8Bytes(text) + 1;
    }
  }
  for (const file of files.slice(peopleLimits.contextFiles)) skipped.push(`${file.name} (${file.id})`);
  if (skipped.length > 0) parts.push(`Not shown, read with memory_read person: ${skipped.join(', ')}`);
  return [head, ...parts, foot].join('\n');
}

/* The outline's People line ------------------------------------------------- */

export interface PersonSummary {
  readonly id: string;
  readonly name: string;
  readonly relationship?: Relationship;
  /** Messages exchanged in the window, for the order. */
  readonly exchanged: number;
}

/**
 * The files part of the outline's People line: how many files there are and
 * the people the owner is most in touch with, by name and relationship,
 * within `max` bytes. Never a file's notes: those are read when a run
 * involves the person, so an ordinary update leaves the outline alone.
 */
export function peopleLine(people: ReadonlyArray<PersonSummary>, max: number): string {
  if (people.length === 0) return '';
  const count = `${people.length} ${people.length === 1 ? 'file' : 'files'}`;
  const top = people
    .toSorted((a, b) => b.exchanged - a.exchanged || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, peopleLimits.outlineTop)
    .map((person) => (person.relationship === undefined ? person.name : `${person.name} (${RELATIONSHIP_LABELS[person.relationship].toLowerCase()})`));
  let line = count;
  let shown = 0;
  for (const name of top) {
    const next = `${line}${shown === 0 ? ', most in touch: ' : ', '}${name}`;
    const rest = people.length - shown - 1;
    if (utf8Bytes(next) + (rest > 0 ? utf8Bytes(` (+${rest} more)`) : 0) > max) break;
    line = next;
    shown += 1;
  }
  return shown < people.length && shown > 0 ? `${line} (+${people.length - shown} more)` : line;
}

/* The people a run involves ------------------------------------------------- */

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The files the owner's words point at: a Slack mention (`<@U0MAYA>`), a
 * full name, or a first name only one file has. In the order they appear.
 */
export function peopleIn(text: string, files: ReadonlyArray<{ readonly id: string; readonly name: string }>): ReadonlyArray<string> {
  const found = new Map<string, number>();
  for (const match of text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)) if (files.some((file) => file.id === match[1])) found.set(match[1]!, match.index);
  const firsts = new Map<string, Array<string>>();
  for (const file of files) {
    const first = file.name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (first !== '') firsts.set(first, [...(firsts.get(first) ?? []), file.id]);
  }
  for (const file of files) {
    const full = new RegExp(`(^|[^\\p{L}])${escapeRegExp(file.name.trim())}(?![\\p{L}])`, 'iu').exec(text);
    const first = file.name.trim().split(/\s+/)[0] ?? '';
    const unique = firsts.get(first.toLowerCase())?.length === 1;
    const short = unique && first.length > 1 ? new RegExp(`(^|[^\\p{L}])${escapeRegExp(first)}(?![\\p{L}])`, 'iu').exec(text) : null;
    const at = full ?? short;
    if (at !== null && !found.has(file.id)) found.set(file.id, at.index);
  }
  return [...found.entries()].toSorted((a, b) => a[1] - b[1]).map(([id]) => id);
}

/* The split of the older People doc ----------------------------------------- */

/** A guess at the relationship from a note's words, or none. */
export function relationshipFrom(text: string): Relationship | undefined {
  if (/\b(reports to me|direct report|my report|on my team|i manage (?:her|him|them))\b/i.test(text)) return 'report';
  if (/\b(skip[- ]level|my manager's manager|my boss's boss)\b/i.test(text)) return 'skip';
  if (/\b(my (?:manager|boss)|i report to|manages me)\b/i.test(text)) return 'manager';
  if (/\b(customer|client)\b/i.test(text)) return 'customer';
  if (/\b(external|vendor|contractor|agency|investor)\b/i.test(text)) return 'external';
  if (/\b(cross[- ]team|other team|another team|partner team)\b/i.test(text)) return 'crossTeam';
  if (/\b(peer|counterpart)\b/i.test(text)) return 'peer';
  return undefined;
}

/** The section a note about a person belongs in, from its words. */
export function sectionFrom(text: string): Section {
  if (relationshipFrom(text) !== undefined || /\b(manager|reports to|direct report|my team)\b/i.test(text)) return 'role';
  if (/\b(prefers? (?:short|long|brief|async|calls?|slack|email|dms?)|formal|casual|tone|emoji|replies|writes? in)\b/i.test(text)) return 'talk';
  if (/\b(owns?|works? on|leads?|leading|building|project|migration|launch|roadmap|reviews?|on-call|hiring)\b/i.test(text)) return 'work';
  return 'notes';
}

export interface PersonMove {
  /** The People entry that moves. */
  readonly entry: string;
  readonly person: string;
  readonly name: string;
  /** Its words without the name in front. */
  readonly text: string;
  readonly section: Section;
  readonly relationship?: Relationship;
}

/**
 * Splits notes of the single People doc into person files. A note that
 * starts with a name and a colon ("Maya Chen: owns the plan") moves to that
 * person's file when `resolve` finds exactly one workspace member by that
 * name; every other note stays a general People note.
 */
export function splitPeopleNotes(
  notes: ReadonlyArray<DocEntry>,
  resolve: (name: string) => ReadonlyArray<{ readonly id: string; readonly name: string }>,
): { readonly moves: ReadonlyArray<PersonMove>; readonly kept: ReadonlyArray<string> } {
  const moves: Array<PersonMove> = [];
  const kept: Array<string> = [];
  for (const note of notes) {
    const match = /^\s*(?:\*\*)?([\p{L}][\p{L}\p{M}.'’-]*(?: [\p{L}][\p{L}\p{M}.'’-]*){0,3})(?:\*\*)?\s*:\s*([\s\S]+)$/u.exec(note.text);
    const members = match === null ? [] : resolve(match[1]!.trim());
    const rest = match?.[2]?.trim() ?? '';
    if (match === null || members.length !== 1 || rest === '') {
      kept.push(note.id);
      continue;
    }
    const relationship = relationshipFrom(rest);
    moves.push({ entry: note.id, person: members[0]!.id, name: members[0]!.name, text: rest, section: sectionFrom(rest), ...(relationship === undefined ? {} : { relationship }) });
  }
  return { moves, kept };
}

/** A file's one line on the page: the first entry of What they work on. */
export const workLine = (entries: ReadonlyArray<PersonEntry>): string | undefined => {
  const first = entries.find((entry) => entry.section === 'work');
  return first === undefined ? undefined : oneLiner(first.text, 160);
};
