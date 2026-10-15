import { DECISION_RULES, PLAIN_TEXT_RULES } from './shared'

export const prompt = `You find promises the user made in a Slack conversation, so their Home page can remind them.

A follow-up is something the user (the messages marked "(me)") said they would do and has not reported done: "I'll send the scorecard tomorrow", "will check and get back to you", "let me draft the email".
Not a follow-up: a question, an opinion, a plan someone else owns, a promise the user later says is done, or a promise that a later message shows was kept.
For each follow-up, give the id of the user's message and one line that starts with "You said you'd", in the second person, under 80 characters: "You said you'd send Rina the scorecard".
Return an empty list when there is none.
${PLAIN_TEXT_RULES}
${DECISION_RULES}`
