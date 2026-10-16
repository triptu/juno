# Juno beside a topic

The owner: "should it be possible to bring juno up as right sidebar on any topic as well, so i can talk with juno in context and it knows what i am looking at".

SPEC §7 "Juno panel" decides behaviour; inventory §12.1 has the sizes. `mock.html` shows it; `node ../../../scripts/heavy.mjs node render.mjs` writes `panel-light.png` and `panel-dark.png` (opened, talking about the topic, and a narrow window).

## Decisions

- **The same single chat.** SPEC 13 says "one thread, no new chat", and a per-topic Juno would bring that back by the side door, with a history per topic to search and to forget. The panel shows the Juno tab's one conversation, opened at the bottom. What makes it "in context" is not a separate thread but the context sent with each message.
- **About lines.** A message sent from the panel carries a small "About {topic}" line above your bubble, in the panel and in the Juno tab. It records what you were looking at, so the shared chat still reads clearly later, and it links back to the topic.
- **What Juno gets** with each panel message: the topic (id, title, channel, kind), the messages on screen, the "new" divider's position, and your selection in the topic. A selection shows above the composer as a removable quote, so you see what is being sent. "This" means the topic.
- **Open and close.** The Juno button in the topic header (the Juno mark, beside More), or ⌘J in a topic tab. ⌘J elsewhere still opens the Juno tab. Esc in the panel's empty composer closes it. Once open it stays open as you move between topic tabs, so it follows what you are reading; it never shows on Home or other pages.
- **Width.** 360px, a hairline on its left. The topic keeps its header and composer and its reading column re-centres in what is left. Below 480px for the topic, the panel covers it rather than squeezing both into columns too narrow to read.
- **Catching up** is a message you type in the panel ("catch me up"); there is no catch-up card at the divider and, since 10-16, no Catch me up chip either. What Juno says and how long is the model's call (decision log 10-14 12:50); no fixed summary format.
- **Trust.** Reading the topic is reading Slack. A panel message therefore counts as having read Slack content in that run (SPEC 13.9): anything that would otherwise need no click becomes a card with a Because line, and sending to Slack is a card as always. The mock shows the Send message card for a reply into the same thread.
- **AI assist off** hides the Juno button; ⌘J in a topic does nothing.

## Review notes (better-interface lens)

- One button, one shortcut, no new settings. The open state is remembered as a single pref.
- The panel appears in one frame with no slide, so the topic reflows once and never animates its text.
- The About line is 11.5 muted and right-aligned over your bubble, so it reads as metadata, not content.

## For the agent build

- The chat contract needs an optional `about: { topicId, title }` on an owner message, and the turn input needs the context block (topic ref, visible range as first and last ts, divider ts, selection text). The context is a reference plus the selection; Juno reads the topic itself through its read tool, which is what makes the trust rule apply.
- The renderer needs the topic's visible range from the message list without re-rendering on scroll: read it from the list's scroll-end snapshot when the panel sends, not continuously.
