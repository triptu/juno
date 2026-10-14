/**
 * A pi extension with one tool and no arguments, for crash tests that need a
 * tool round. pi commits the call's execute intent between `beforeTool` and
 * `execute`, so a kill in `beforeTool` leaves a journal without the intent,
 * and a kill in `execute` leaves one with it. The tool keeps pi's default
 * `replay: "unsafe"`, as every tool with an effect must.
 */
import { Type } from '@earendil-works/pi-ai'
import { defineExtension, defineTool, hook, ToolTask, type Extension } from '@earendil-works/pi-durable'

export interface TestToolOptions {
  readonly name: string
  /** Runs before pi commits the call's execute intent. */
  readonly beforeTool?: () => void
  /** The tool's `execute()`. Its text is the result the model sees. */
  readonly execute: () => Promise<string>
}

export function testTool(options: TestToolOptions): Extension {
  const tool = defineTool({
    name: options.name,
    description: `The test tool ${options.name}`,
    parameters: Type.Object({}),
    execute: async () => ({ output: [{ type: 'text', text: await options.execute() }] }),
  })
  const beforeTool = () => {
    options.beforeTool?.()
    return undefined
  }
  return defineExtension({ name: `test-${options.name}`, tools: [tool], hooks: [hook(ToolTask, { beforeTool })] })
}
