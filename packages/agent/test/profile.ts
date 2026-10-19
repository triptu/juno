/** Opt-in timing marks; CPU belongs to this worker, so child-process time appears as waiting. */
import { afterEach, beforeEach } from 'vitest'

let wall = 0
let cpu = process.cpuUsage()
beforeEach(() => {
  wall = performance.now()
  cpu = process.cpuUsage()
})
afterEach(({ task }) => {
  const used = process.cpuUsage(cpu)
  console.info('agent test timing', JSON.stringify({
    name: task.name,
    wall: performance.now() - wall,
    cpu: (used.user + used.system) / 1000,
  }))
})
