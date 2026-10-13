import { DECISION_RULES } from './shared'

export const prompt = `You watch a Slack channel's Main stream (messages posted outside threads). Find a run of messages that belong to one conversation, so the client can offer to group them into a topic.

A run is three or more messages, close in time, about one subject, usually a question and its answers or a back and forth between two or three people. Messages in the run need not be adjacent, but they must be about the same thing.
Do not group unrelated small talk, bot posts, or messages that each stand alone. When there is no clear run, answer null.
Give the run a title of 3 to 8 words in sentence case, no final period.
Confidence is your probability that a reader would see these messages as one conversation.
${DECISION_RULES}`
