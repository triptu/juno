import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { prompt } from './instructionRule.prompt'

export interface InstructionRuleInput {
  readonly text: string
  /** The people and channels the instruction names, as the engine found them. */
  readonly people: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly channels: ReadonlyArray<{ readonly id: string; readonly name: string }>
}

export const InstructionRuleOutput = Type.Object({
  rule: Type.Union([
    Type.Object({ kind: Type.Union([Type.Literal('person'), Type.Literal('channel')]), id: Type.String(), level: Type.Union([Type.Literal('always'), Type.Literal('never')]) }),
    Type.Null(),
  ]),
})

/**
 * Decision, once per added instruction (SPEC 14, "Your instructions"):
 * whether it is really a person or channel level. A chat model answers.
 * Nothing waits on it: the instruction is saved at once and the offer
 * shows when the answer comes. Luna took 2.8 to 3.9 s on 2026-10-23, so
 * 10 s leaves room for a slow call and its retry.
 */
export const instructionRule = defineStructuredTask<InstructionRuleInput, typeof InstructionRuleOutput>({
  name: 'instructionRule',
  version: 1,
  tier: 'decision',
  timeoutMillis: 10_000,
  prompt,
  tool: { name: 'rule', description: 'Report the person or channel level the instruction means, or null.' },
  output: InstructionRuleOutput,
  accept: (out, input) => out.rule === null || (out.rule.kind === 'person' ? input.people : input.channels).some((item) => item.id === out.rule?.id),
  render: (input) =>
    [
      `Instruction: ${input.text}`,
      `People: ${input.people.map((p) => `${p.name} (${p.id})`).join(', ') || 'none'}`,
      `Channels: ${input.channels.map((c) => `#${c.name} (${c.id})`).join(', ') || 'none'}`,
    ].join('\n'),
  key: () => '',
})
