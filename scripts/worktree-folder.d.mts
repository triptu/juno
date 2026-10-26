import type { existsSync } from 'node:fs'

export const AGENT_WORK: '/Volumes/AgentWork'
export function agentWork(options?: { exists?: typeof existsSync }): string | undefined
export function mainCheckout(checkout: string): string
export function worktreeFolder(main: string, options?: { env?: NodeJS.ProcessEnv; exists?: typeof existsSync }): string
export function scratchFolder(options?: { exists?: typeof existsSync }): string
