# Sidebar views

The owner's request (10-15, `docs/decision-log.md`): more custom views in the sidebar's filter row, as horizontally scrollable pills, with Channels and DMs as icons, and a way to keep noisy channels out of All. Applied to SPEC 5 ("Views") and inventory 2.3, 15.1, 15.2, 15.7, 15.8 and 16.

`mock.html` is a quick render with the app's tokens. `node ../../../scripts/heavy.mjs node render.mjs` writes the PNGs.

| File | What |
| --- | --- |
| `views-light.png`, `views-dark.png` | The pill row overflowing (All selected), scrolled (a view selected), with no views; the view sheet; Add to view on a Main row's menu |

## Decisions

- **A view is a hand-picked set of conversations.** Its list is the sidebar's rules (followed threads, unread mentions, Main) limited to those conversations. No rules, no keywords.
- **One setting, Keep these out of All.** On, the view's conversations leave All, Channels and DMs and their dots. ⌘K, All topics, Home and notifications still see everything. A scope ("Show its topics") still shows them.
- **The dot means an unread mention.** A bot view stays quiet on plain unread. Channels and DMs keep their dot as before.
- **The sheet has four fields**: name, optional icon, conversations, the setting. Save and Cancel. Nothing else.
- **The row never grows.** It scrolls sideways; a vertical wheel scrolls it sideways too; overscroll is contained, so it never moves the list or triggers Back and Forward. The edge it can scroll toward fades.
- **The dot sits in the pill's corner**, so icon pills stay 28×28 and nothing moves when it shows.
- **Keep these out of All is a checkbox**, as in a macOS sheet; the app has no switch primitive and one checkbox is enough.
- **Juno making a view** ("make a Bots view with every alerts channel") is a seam: the engine's `views.save` is the command a Juno settings tool will call. Wiring it into the agent needs a new AgentHost route, so it is left for the agent work.
