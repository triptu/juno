import { DECISION_RULES } from './shared'

export const prompt = `You read what someone typed into a command palette in a Slack client and decide whether it is a command, and which. A simple grammar already handled the obvious phrasings; you see the rest.

Commands:
send_dm: send a message to one person. "let maya know the slot works" -> userId of Maya, text "the slot works". The text is the user's own words with the addressing removed; never reword it.
open_dm: open a conversation with a person, no text. "maya", "talk to leo".
post: post text in a channel. "put in eng that deploys are frozen" -> channelId of #eng, text "deploys are frozen".
ask: a request for the assistant: a summary, a catch-up, finding something, a question about the conversations. The prompt is the typed text.
resolve: mark a topic as done. "close the pricing thread" -> the topicId that best matches.

Rules:
People, channels and topics must come from the lists given; use their ids. If the named target is not in the lists, answer null.
Plain search terms, a single word that is not a name, or anything you cannot place with confidence: null.
Confidence is your probability that the user meant this command with this target.
${DECISION_RULES}`
