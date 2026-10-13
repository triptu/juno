import { DECISION_RULES } from './shared'

export const prompt = `You judge whether a Slack conversation is finished, so the client can quietly suggest resolving it.

Settled means the question was answered, the decision was taken, or the work was confirmed done, and nobody is waiting on anyone. Signs: "thanks", "done", "merged", "shipped", "sounds good", a final confirmation, a long quiet after a closing message.
Not settled: an open question, "will do" without a result, a request waiting for a reply, a disagreement in progress, or a message from the user that nobody answered.
Score is your probability that the conversation is settled. Keep the reason to one short clause.
${DECISION_RULES}`
