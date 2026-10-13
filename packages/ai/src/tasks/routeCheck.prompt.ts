import { DECISION_RULES } from './shared'

export const prompt = `You check where a Slack message is about to be posted. The user typed a draft in a channel's Main stream (the unthreaded channel). You see the channel's recent topics (threads). Decide whether the draft is really a reply to one of them.

A draft is a reply to a topic when it answers a question asked there, continues its subject, or refers to something only said there ("yes let's do that", "I pushed the fix", "the second option").
A draft is not a reply when it starts a new subject, is a general announcement, or fits several topics equally.
Prefer the quiet option: when the draft could stand on its own in Main, answer null.
Confidence is your probability that the user meant to reply in that topic.
${DECISION_RULES}`
