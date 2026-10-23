import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  checkPersonEntry, docLimits, dueForUpdate, mayKeepFile, outline, peopleContext, peopleIn, peopleLimits, peopleLine,
  qualifies, rankPeople, relationshipFrom, sensitiveKind, splitPeopleNotes, utf8Bytes,
} from '../src/index.ts';
import type { DocEntry, Interaction, PersonEntry, PersonFile, PersonSummary } from '../src/index.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = 100 * DAY;
const met = (id: string, owner: number, them: number, daysAgo = 1): Interaction => ({ id, name: id, owner, them, lastAt: now - daysAgo * DAY });

describe('who gets a file', () => {
  test('a real exchange both ways, above the threshold, in the last 60 days', () => {
    expect(qualifies(met('maya', 3, 4), now)).toBe(true);
    // One side only is not an exchange: a channel they post in, or the owner's unanswered DMs.
    expect(qualifies(met('lee', 0, 30), now)).toBe(false);
    expect(qualifies(met('lee', 30, 0), now)).toBe(false);
    // A hello and a thanks is under the threshold.
    expect(qualifies(met('sam', 1, 1), now)).toBe(false);
    expect(qualifies(met('sam', 2, 2), now)).toBe(true);
    // Older than the window.
    expect(qualifies(met('old', 10, 10, 61), now)).toBe(false);
  });

  test('anyone else only when the owner asks', () => {
    expect(mayKeepFile({ asked: false, interaction: undefined, now })).toBe(false);
    expect(mayKeepFile({ asked: false, interaction: met('sam', 1, 1), now })).toBe(false);
    expect(mayKeepFile({ asked: true, interaction: undefined, now })).toBe(true);
    expect(mayKeepFile({ asked: false, interaction: met('maya', 5, 5), now })).toBe(true);
  });

  test('ranks by messages exchanged, then the most recent', () => {
    const ranked = rankPeople([met('a', 2, 2, 3), met('b', 10, 1), met('c', 2, 2, 1)]);
    expect(ranked.map((person) => person.id)).toEqual(['b', 'c', 'a']);
  });

  test('a background update is due at most daily, and only after a new exchange', () => {
    const maya = met('maya', 5, 5, 0);
    expect(dueForUpdate(maya, undefined, now)).toBe(true);
    expect(dueForUpdate(maya, now - DAY / 2, now)).toBe(false);
    expect(dueForUpdate(maya, now - 2 * DAY, now)).toBe(true);
    expect(dueForUpdate({ ...maya, lastAt: now - 3 * DAY }, now - 2 * DAY, now)).toBe(false);
    expect(dueForUpdate(met('sam', 1, 1, 0), undefined, now)).toBe(false);
  });
});

describe('sensitive details', () => {
  const file: ReadonlyArray<PersonEntry> = [];
  const juno = { ownerWords: false };

  test.each([
    ['On sick leave until March', 'health'],
    ['Has a therapy appointment every Tuesday', 'health'],
    ['Got a raise to 180k, salary review in June', 'money'],
    ['Going through a divorce', 'family'],
    ['Leaves early to pick up the kids', 'family'],
    ['On a performance improvement plan', 'performance'],
    ['Promo packet goes to the committee this week', 'performance'],
    ['Phone is 415 555 0134', 'contact'],
    ['Personal email is maya@example.com', 'contact'],
  ])('Juno never writes "%s" (%s) on its own', (text, kind) => {
    expect(sensitiveKind(text)).toBe(kind);
    expect(checkPersonEntry('notes', text, file, juno)).toBe('sensitive');
  });

  test('the owner may say it themselves', () => {
    expect(checkPersonEntry('notes', 'On parental leave until March', file, { ownerWords: true })).toBeUndefined();
  });

  test.each([
    'Owns the Postgres 16 migration plan',
    'Prefers short async messages, replies within the hour',
    'Works from Berlin, mornings are best',
    'Reviews the backfill PRs',
    'Lead on the Jason integration',
  ])('ordinary work notes pass: "%s"', (text) => {
    expect(checkPersonEntry('work', text, file, juno)).toBeUndefined();
  });

  test('keys are refused whoever says them, and a file has its limits', () => {
    expect(checkPersonEntry('notes', 'her token: xoxb-1234567890-abcdefghij', file, { ownerWords: true })).toBe('secret');
    const full = Array.from({ length: peopleLimits.sectionEntries }, (_, i): PersonEntry => ({ id: `e${i}`, section: 'work', text: `project ${i}` }));
    expect(checkPersonEntry('work', 'one more project', full, juno)).toBe('sectionFull');
    expect(checkPersonEntry('notes', 'still room here', full, juno)).toBeUndefined();
    const big = Array.from({ length: 6 }, (_, i): PersonEntry => ({ id: `e${i}`, section: (['role', 'talk', 'notes'] as const)[i % 3]!, text: 'x'.repeat(550) }));
    expect(checkPersonEntry('work', 'y'.repeat(200), big, juno)).toBe('fileFull');
  });
});

describe('the outline budget', () => {
  const people = (n: number): ReadonlyArray<PersonSummary> =>
    Array.from({ length: n }, (_, i) => ({ id: `U${i}`, name: `Person Number${i}`, exchanged: n - i, ...(i % 3 === 0 ? { relationship: 'peer' as const } : {}) }));

  test('names the count and at most the ten most in touch, never their notes', () => {
    const line = peopleLine(people(14), docLimits.outlinePeople);
    expect(line).toMatch(/^14 files, most in touch: Person Number0 \(peer\), Person Number1, /);
    expect(line).not.toContain('Person Number10');
    expect(line).toMatch(/\(\+\d+ more\)$/);
    expect(peopleLine([], docLimits.outlinePeople)).toBe('');
  });

  test('stays within its share and keeps the outline within budget, whatever the files and notes', () => {
    const note = fc.string({ minLength: 1, maxLength: 300 }).filter((s) => s.trim() !== '');
    fc.assert(fc.property(fc.nat({ max: 250 }), fc.array(note, { maxLength: 60 }), (n, notes) => {
      const line = peopleLine(people(n), docLimits.outlinePeople);
      expect(utf8Bytes(line)).toBeLessThanOrEqual(docLimits.outlinePeople);
      const entries: ReadonlyArray<DocEntry> = notes.map((text, i) => ({ id: `e${i}`, doc: i % 2 === 0 ? 'people' : 'you', text }));
      const text = outline(entries, 1, docLimits.outline, line);
      expect(utf8Bytes(text)).toBeLessThanOrEqual(docLimits.outline);
      if (n > 0) expect(text).toContain(`People: ${n} file`);
    }));
  });

  test('an update to a file leaves the outline as it was', () => {
    const before = outline([], 3, docLimits.outline, peopleLine(people(4), docLimits.outlinePeople));
    const after = outline([], 3, docLimits.outline, peopleLine(people(4), docLimits.outlinePeople));
    expect(after).toBe(before);
  });

  test('a run carries at most three files, within its bytes, and names the rest', () => {
    const file = (i: number): PersonFile => ({ id: `U${i}`, name: `Person ${i}`, entries: [{ id: `e${i}`, section: 'talk', text: 'z'.repeat(500) }] });
    const text = peopleContext([0, 1, 2, 3, 4].map(file));
    expect(utf8Bytes(text)).toBeLessThanOrEqual(peopleLimits.contextBytes);
    expect(text.match(/^## /gm)).toHaveLength(3);
    expect(text).toContain('Not shown, read with memory_read person: Person 3 (U3), Person 4 (U4)');
    expect(peopleContext([])).toBe('');
  });
});

describe('the people a run involves', () => {
  const files = [{ id: 'U0MAYA', name: 'Maya Chen' }, { id: 'U0LEO', name: 'Leo Park' }, { id: 'U0LEA', name: 'Leo Brand' }];

  test('a mention, a full name, or a first name only one file has', () => {
    expect(peopleIn('ask <@U0LEO> about it', files)).toEqual(['U0LEO']);
    expect(peopleIn('draft a reply to maya chen', files)).toEqual(['U0MAYA']);
    expect(peopleIn('what did Maya say?', files)).toEqual(['U0MAYA']);
    // Two files share "Leo", so the first name alone names nobody.
    expect(peopleIn('what did Leo say?', files)).toEqual([]);
    expect(peopleIn('Leo Brand and then Maya', files)).toEqual(['U0LEA', 'U0MAYA']);
    expect(peopleIn('Mayan ruins', files)).toEqual([]);
  });
});

describe('splitting the People doc', () => {
  const members: Record<string, ReadonlyArray<{ id: string; name: string }>> = {
    'maya chen': [{ id: 'U0MAYA', name: 'Maya Chen' }],
    maya: [{ id: 'U0MAYA', name: 'Maya Chen' }],
    sam: [{ id: 'U0SAM', name: 'Sam Okafor' }, { id: 'U0SAMR', name: 'Sam Rivera' }],
  };
  const resolve = (name: string) => members[name.toLowerCase()] ?? [];
  const note = (id: string, text: string): DocEntry => ({ id, doc: 'people', text });

  test('a "Name: …" note moves to the one member with that name; the rest stay general', () => {
    const { moves, kept } = splitPeopleNotes([
      note('e1', 'Maya Chen: owns the Postgres 16 migration plan'),
      note('e2', 'maya: my manager, prefers short updates'),
      note('e3', 'Sam: runs the platform team'),
      note('e4', 'Priya: designs the onboarding'),
      note('e5', 'The design team meets on Thursdays'),
      note('e6', 'Maya Chen:'),
    ], resolve);
    expect(moves).toEqual([
      { entry: 'e1', person: 'U0MAYA', name: 'Maya Chen', text: 'owns the Postgres 16 migration plan', section: 'work' },
      { entry: 'e2', person: 'U0MAYA', name: 'Maya Chen', text: 'my manager, prefers short updates', section: 'role', relationship: 'manager' },
    ]);
    // Two Sams, no Priya in the workspace, no name in front, nothing after the name.
    expect(kept).toEqual(['e3', 'e4', 'e5', 'e6']);
  });

  test('guesses a relationship from plain words, and none when it is unclear', () => {
    expect(relationshipFrom('reports to me since May')).toBe('report');
    expect(relationshipFrom('I report to her')).toBe('manager');
    expect(relationshipFrom('my skip-level')).toBe('skip');
    expect(relationshipFrom('our customer at Acme')).toBe('customer');
    expect(relationshipFrom('likes ramen')).toBeUndefined();
  });
});
