import type { EngineToMain, MainToEngine } from '@juno/contract'

type Request = Extract<MainToEngine, { _tag: 'testWork' }>

/** Observes engine calls and correlates work acknowledgments for e2e tests. */
export function createEngineTestHooks(enabled: boolean, send: (request: Request) => void) {
  const calls: Record<string, number> = {}
  let nextId = 0
  const replies = new Map<number, (error: string | undefined) => void>()
  const workPass = (name: Request['name']) => new Promise<void>((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      replies.delete(id)
      reject(new Error(`${name} pass did not finish within 10 s`))
    }, 10_000)
    replies.set(id, (error) => {
      clearTimeout(timer)
      replies.delete(id)
      if (error === undefined) resolve()
      else reject(new Error(error))
    })
    send({ _tag: 'testWork', id, name })
  })
  return {
    handle: (message: EngineToMain): boolean => {
      if (message._tag === 'aiCall') {
        if (enabled) calls[message.task] = (calls[message.task] ?? 0) + 1
        return true
      }
      if (message._tag === 'testWorkDone') {
        if (enabled) replies.get(message.id)?.(message.error)
        return true
      }
      return false
    },
    hooks: { aiCalls: () => ({ ...calls }), workPass },
  }
}
