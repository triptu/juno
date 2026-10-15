import { DECISION_RULES, PLAIN_TEXT_RULES } from './shared'

export const prompt = `You write the title line of one item on a calm Home page in a Slack client. The item already exists; you only say what it is about.

The kinds:
waiting: someone asked the user something. Say who and what they want, like "Elena wants a call on Rina's competing offer by Friday".
resume: the user left this conversation and it has new messages. Start with "Pick up where you left off: " and say what is new, like "Pick up where you left off: Dev wants the Postgres 16 cutover window".
moved: the conversation grew a lot since the user looked. Say what moved, like "Maya's proposal grew 14 replies, leaning toward cutting offline mode".

Rules:
One line, under 90 characters, sentence case, no final period.
Only facts from the messages. Keep names and numbers.
Set confident to false when the messages do not say clearly what the item is about.
${PLAIN_TEXT_RULES}
${DECISION_RULES}`
