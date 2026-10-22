/** Fixed copy also used by Home, topic actions and the tab strip, without the Juno pages. */
export const listedSources = (names: ReadonlyArray<string>): string => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

export const junoPageTitles = {
  scheduled: 'Scheduled',
  remembers: 'What Juno remembers',
  memory: 'Memory of this chat',
  activity: 'Activity',
  connections: 'Connections',
  settings: 'Settings',
  review: 'Review',
} as const

export const junoPanelCopy = {
  /** The selection toolbar's button beside Quote (SPEC 7, Quoting). */
  askJuno: 'Ask Juno',
} as const

export const junoAskCopy = {
  learn: {
    title: { setup: 'Let Juno learn how you work', connection: (name: string) => `Let Juno learn from ${name}` },
    /** Home's meta line. */
    meta: (sources: ReadonlyArray<string>) => `Reads ${listedSources(['your Slack messages', ...sources])}`,
    metaConnection: (name: string) => `Reads ${name}`,
    start: 'Start',
    notNow: 'Not now',
    started: 'Juno is learning how you work',
  },
} as const

export const personFileMissing = (name: string) => `Juno has no file on ${name} yet. It starts one once you message with them, or when you ask.`
