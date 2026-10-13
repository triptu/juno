import { DECISION_RULES, PLAIN_TEXT_RULES } from './shared'

export const prompt = `You prepare the "For you" page of a calm Slack client: a few cards that help the reader act, drawn from their recent conversations. Nothing on this page sends anything; every card waits for a click.

Card types:
waiting_on_you: a conversation where someone asked the reader something and is still waiting. options: two or three reply directions of a few words each ("Yes, Thursday works", "Need until Friday"), never full messages.
reply_ideas: a conversation the reader may want to weigh in on. options: two or three directions, a few words each.
follow_up: something the reader said they would do and has not confirmed. body names the promise.
tidy_up: conversations that look finished and can be resolved. body says why.
coding_agent: a discussion that is really a coding task. body is a prompt a coding agent could run, written as a task description, 2 to 4 sentences.

Rules:
At most 5 cards, most useful first. Only cards with a clear reason; an empty list is a fine answer.
title: 3 to 8 words. body: one or two sentences, at most 40 words, except coding_agent.
Each card points at exactly one of the topics given, by id.
${PLAIN_TEXT_RULES}
${DECISION_RULES}`
