import { rm } from 'node:fs/promises'
import { expect, hooks, launchApp, tempUserData, test } from '../fixtures'

// One launch: the renderer's port to the agent first, then a crash and the restart.
test('the agent answers the renderer on its port, and restarts after a crash', async () => {
  const userData = await tempUserData()
  const { app, win, close } = await launchApp(userData, { agent: true })
  try {
    // Main brokers a port between the renderer and the agent (ADR 0012), and the agent serves its
    // renderer RPCs on it: a first request for the chat summary answers.
    await test.step("the renderer gets a port to the agent, and the agent's chat answers on it", async () => {
      await expect.poll(() => hooks(app, 'agentState'), { timeout: 15_000 }).toBe('ready')
      const answer = await win.evaluate(
        () =>
          new Promise<unknown>((resolve, reject) => {
            setTimeout(() => reject(new Error('no answer from the agent')), 10_000)
            const onMessage = (event: MessageEvent) => {
              if (event.source !== window || (event.data as { _tag?: string } | null)?._tag !== 'juno.agentPort') return
              window.removeEventListener('message', onMessage)
              const port = event.ports[0]!
              // The effect/workers framing: the runner says ready with [0], answers with [1, message].
              port.addEventListener('message', (reply) => {
                const [kind, message] = reply.data as [number, unknown]
                if (kind === 1) resolve(message)
              })
              port.start()
              port.postMessage([0, { _tag: 'Request', id: '1', tag: 'agent.chat.summary', payload: null, headers: [] }])
            }
            window.addEventListener('message', onMessage)
            void window.juno.agent.requestPort().then((result) => {
              if (result !== 'sent') reject(new Error(`main answered ${String(result)}`))
            })
          }),
      )
      expect(JSON.stringify(answer)).toContain('"unread":0')
    })

    // A crashed agent is forked again and gets a new port to the engine (ADR 0012).
    await test.step('the agent process restarts after a crash and reaches its host again', async () => {
      await expect.poll(() => hooks(app, 'agentState'), { timeout: 15_000 }).toBe('ready')
      const pid = await hooks(app, 'agentPid')
      process.kill(pid!, 'SIGKILL')
      await expect.poll(() => hooks(app, 'agentPid'), { timeout: 15_000 }).not.toBe(pid)
      await expect.poll(() => hooks(app, 'agentState'), { timeout: 15_000 }).toBe('ready')
      expect(await hooks(app, 'agentHost')).toBe('juno')
    })
  } finally {
    await close()
    await rm(userData, { recursive: true, force: true })
  }
})
