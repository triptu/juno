/**
 * Invented people, places and screens for the huddle fixtures. No real
 * Slack data: names and pictures are made up, and the screens are drawn.
 */
import type { HuddlePerson, HuddlePlace } from '../model'
import type { ScreenSource } from '../ScreenSourcePicker'

export const noop = () => {}

export const eng: HuddlePlace = { name: 'eng', kind: 'public' }
export const hiring: HuddlePlace = { name: 'hiring-loop', kind: 'private' }
export const maya: HuddlePlace = { name: 'Maya Chen', kind: 'dm' }
export const group: HuddlePlace = { name: 'Maya, Leo, Priya', kind: 'group' }
export const longPlace: HuddlePlace = { name: 'customer-escalations-and-incident-follow-ups', kind: 'public' }

export const you: HuddlePerson = { id: 'U0TUSHAR', name: 'Tushar', initials: 'T', hue: 'cyan', you: true }
export const people: ReadonlyArray<HuddlePerson> = [
  { id: 'U0MAYA', name: 'Maya Chen', initials: 'MC', hue: 'rose' },
  { id: 'U0LEO', name: 'Leo Park', initials: 'LP', hue: 'emerald' },
  { id: 'U0PRIYA', name: 'Priya Natarajan', initials: 'PN', hue: 'plum' },
  { id: 'U0SAM', name: 'Sam Okafor', initials: 'SO', hue: 'midnight' },
  { id: 'U0ALEX', name: 'Alex Kim', initials: 'AK', hue: 'emeraldDark' },
  { id: 'U0DONNA', name: 'Donna Reyes', initials: 'DR', hue: 'jordy' },
  { id: 'U0ELENA', name: 'Elena Rossi', initials: 'ER', hue: 'claret' },
  { id: 'U0JONAS', name: 'Jonas Weber', initials: 'JW', hue: 'rose' },
  { id: 'U0RUTH', name: 'Ruth Abebe', initials: 'RA', hue: 'emerald' },
]

/** The first `n` others, with some of them muted or speaking. */
export function others(n: number, change: { readonly speaking?: string; readonly muted?: ReadonlyArray<string> } = {}): ReadonlyArray<HuddlePerson> {
  return people.slice(0, n).map((person) => ({
    ...person,
    ...(change.speaking === person.id ? { speaking: true } : {}),
    ...(change.muted?.includes(person.id) === true ? { muted: true } : {}),
  }))
}

// A made-up screen: a window with a title bar, a sidebar and text lines, in one tone. Fixture data, not UI.
function screen(width: number, height: number, tone: string, ink: string): string {
  const lines = Array.from({ length: 9 }, (_, i) => `<rect x="${width * 0.3}" y="${height * (0.2 + i * 0.07)}" width="${width * (0.35 + ((i * 37) % 30) / 100)}" height="${height * 0.025}" rx="${height * 0.012}" fill="${ink}" opacity="0.35"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${tone}"/><rect x="${width * 0.04}" y="${height * 0.06}" width="${width * 0.92}" height="${height * 0.88}" rx="${height * 0.02}" fill="#FCFBF7"/><rect x="${width * 0.04}" y="${height * 0.06}" width="${width * 0.92}" height="${height * 0.07}" rx="${height * 0.02}" fill="${ink}" opacity="0.12"/><rect x="${width * 0.06}" y="${height * 0.18}" width="${width * 0.18}" height="${height * 0.7}" rx="${height * 0.015}" fill="${ink}" opacity="0.08"/>${lines}</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function appIcon(tone: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="${tone}"/><rect x="4" y="5" width="8" height="1.5" rx="0.75" fill="#FFFFFF"/><rect x="4" y="8" width="6" height="1.5" rx="0.75" fill="#FFFFFF"/></svg>`)}`
}

export const pictures = {
  maya: screen(1600, 1000, '#8EB5C9', '#20323C'),
  leo: screen(1440, 900, '#C9B48E', '#3C3020'),
  tall: screen(1000, 1400, '#A7B8A0', '#22301E'),
  // The user's own window, as the source picker's "Q4 roadmap — Docs".
  window: screen(1200, 800, '#D9C7E8', '#2E2238'),
}

export const sources: ReadonlyArray<ScreenSource> = [
  { id: 'screen:1', name: 'Built-in display', kind: 'screen', thumbnailUrl: screen(1600, 1000, '#8EB5C9', '#20323C') },
  { id: 'screen:2', name: 'Studio Display', kind: 'screen', thumbnailUrl: screen(1920, 1080, '#B9C7D9', '#1E2A3A') },
  { id: 'window:1', name: 'Q4 roadmap — Docs', kind: 'window', thumbnailUrl: screen(1200, 800, '#D9C7E8', '#2E2238'), appIconUrl: appIcon('#5B6CF0') },
  { id: 'window:2', name: 'Terminal — deploy.sh', kind: 'window', thumbnailUrl: screen(900, 600, '#3A3A3A', '#E0E0E0'), appIconUrl: appIcon('#2B2B2B') },
  { id: 'window:3', name: 'Figma — Huddle bar explorations, final final v3', kind: 'window', thumbnailUrl: screen(1440, 900, '#E8D9C7', '#3A2E22'), appIconUrl: appIcon('#E0583A') },
  { id: 'window:4', name: 'Preview — floor-plan.pdf', kind: 'window', thumbnailUrl: screen(1000, 1300, '#A7B8A0', '#22301E'), appIconUrl: appIcon('#3C8D5A') },
]

export const manyWindows: ReadonlyArray<ScreenSource> = [
  ...sources,
  ...Array.from({ length: 8 }, (_, i): ScreenSource => ({ id: `window:x${i}`, name: `Safari — Tab ${i + 1}`, kind: 'window', thumbnailUrl: screen(1440, 900, '#C9D9E8', '#1E2A3A'), appIconUrl: appIcon('#2F7FE8') })),
]
