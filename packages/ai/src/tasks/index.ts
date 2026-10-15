/** The task table. One row per AI feature in SPEC section 15 and architecture section 10. */
import { chat } from './chat'
import { followUps } from './followUps'
import { homeTitle } from './homeTitle'
import { parseCommand } from './parseCommand'
import { routeCheck } from './routeCheck'
import { settledScore } from './settledScore'
import { titleTopic } from './titleTopic'
import { topicArt } from './topicArt'
import { urgencyGate } from './urgencyGate'

export const tasks = {
  titleTopic,
  routeCheck,
  settledScore,
  urgencyGate,
  parseCommand,
  chat,
  topicArt,
  followUps,
  homeTitle,
} as const

export type TaskName = keyof typeof tasks

/** The structured tasks, for the eval and for schema tests. */
export const decisionTasks = [routeCheck, settledScore, urgencyGate, parseCommand, followUps] as const

export * from './shared'
export * from './titleTopic'
export * from './routeCheck'
export * from './settledScore'
export * from './urgencyGate'
export * from './parseCommand'
export * from './chat'
export * from './topicArt'
export * from './followUps'
export * from './homeTitle'
