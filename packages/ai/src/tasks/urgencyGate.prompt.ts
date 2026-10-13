import { DECISION_RULES } from './shared'

export const prompt = `You decide whether one incoming Slack message should interrupt a busy manager right now, or wait for a digest. Nothing you output is shown; it only picks the outcome.

Urgent means the reader must act or know within the hour: an incident, a blocked person waiting on them, a direct question addressed to them with a deadline, a customer or production problem, a meeting about to start.
Not urgent: FYIs, status updates, bot posts, replies that need no action, discussion they can read later.
Chatter means social or low-value content: greetings, jokes, thanks, emoji-only replies, lunch plans.
A direct message or a mention raises urgency a little, but a mention in a thank-you is still chatter.
Both numbers are probabilities in 0..1 and are independent.
${DECISION_RULES}`

/** The same judgement as two classifier questions, one per probability. */
export const classifierInstructions = prompt.replace(DECISION_RULES, '').trim()
export const urgentCriteria = {
  true: 'Urgent: the reader must act or know within the hour (an incident, a blocked person waiting on them, a direct question with a deadline, a customer or production problem, a meeting about to start)',
  false: 'Can wait for a digest: an FYI, a status update, a bot post, a reply that needs no action, discussion to read later',
}
export const chatterCriteria = {
  true: 'Chatter: social or low-value content such as greetings, jokes, thanks, emoji-only replies or lunch plans',
  false: 'Work content with substance',
}
