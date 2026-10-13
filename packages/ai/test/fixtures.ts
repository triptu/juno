import type { ChannelId, TopicId, UserId } from '@juno/domain'
import type { AiMessage } from '../src/index'

export const T = (id: string) => id as TopicId
export const C = (id: string) => id as ChannelId
export const U = (id: string) => id as UserId

export const at = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 13, 9, 30 - minutesAgo)).toISOString()
export const msg = (sender: string, text: string, minutesAgo: number, fromMe = false): AiMessage => ({ sender, text, at: at(minutesAgo), fromMe })
export const NOW = at(0)

export const stagingBill = {
  id: T('t:C0ENG:1728800000.000100'),
  title: 'Staging bill doubled since August',
  recent: [
    msg('Leo Park', 'Staging bill doubled since August. Anyone know what changed?', 90),
    msg('Jonas Weber', 'We left the perf cluster running after the load test. I will scale it down.', 80),
  ],
}

export const postgres = {
  id: T('t:C0ENG:1728700000.000200'),
  title: 'Postgres 16 migration plan',
  recent: [msg('Dev Patel', 'Draft of the Postgres 16 migration plan is in the doc. Two options for the cutover window.', 300)],
}

export const people = [
  { id: U('U0MAYA'), name: 'Maya Chen' },
  { id: U('U0LEO'), name: 'Leo Park' },
]
export const channels = [{ id: C('C0ENG'), name: 'eng', kind: 'public' as const }]
