/** The task table. One row per AI feature in SPEC section 15 and architecture section 10. */
import { catchUp } from './catchUp'
import { chat } from './chat'
import { groupRun } from './groupRun'
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
  groupRun,
  urgencyGate,
  parseCommand,
  catchUp,
  chat,
  topicArt,
} as const

export type TaskName = keyof typeof tasks

/** The structured tasks, for the eval and for schema tests. */
export const decisionTasks = [routeCheck, settledScore, groupRun, urgencyGate, parseCommand] as const

export * from './shared'
export * from './titleTopic'
export * from './routeCheck'
export * from './settledScore'
export * from './groupRun'
export * from './urgencyGate'
export * from './parseCommand'
export * from './catchUp'
export * from './chat'
export * from './topicArt'
