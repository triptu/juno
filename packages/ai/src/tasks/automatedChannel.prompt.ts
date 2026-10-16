import { DECISION_RULES } from './shared'

export const prompt = `You judge whether a Slack conversation is automated, so the client can keep it in a separate Automated view, out of the main list.

Automated means apps, bots and integrations post most of it and people rarely talk there: alerts, monitoring, deploy and CI notices, ticket and pull request feeds, digests. Messages marked "(app)" come from an app or bot.
Not automated: people discuss, ask and decide there, even when an app posts many of the messages. A channel where people reply to the alerts and work through them is not automated. A project channel where a meeting-notes app posts notes and people talk about the work is not automated.
Hiding a conversation people talk in costs more than leaving a bot channel in the list. When people write there in their own words, give a low probability.
Probability is your probability that the conversation is automated. The reason is one short plain clause, under eight words, about who writes there, such as "Only deploy notices, no replies".
${DECISION_RULES}`

/** The same judgement as a classifier question: is the conversation automated. */
export const classifierInstructions = prompt.replace(DECISION_RULES, '').trim()
export const automatedCriteria = {
  true: 'Automated: apps, bots and integrations post most of it and people rarely talk there',
  false: 'Not automated: people discuss, ask and decide there, even when an app posts many of the messages',
}
