# Juno panel polish, 2026-10-17

Owner feedback from daily use of the DMG: remove the Catch me up button, show the channel context more nicely, open the chat at the bottom, and fix the panel colour in light and dark.

Shots of the real app against the fake Slack and a fake model, 1440 by 900 at 2x, with eight exchanges in the chat. `before-*` is origin/main at 4e1d6f0e, `after-*` is this branch. Written by `apps/desktop/e2e/screens/panel-shots.spec.ts`:

    JUNO_SCREENS=1 JUNO_SHOTS_PREFIX=after JUNO_SHOTS_ACCENTS=1 pnpm test:desktop e2e/screens/panel-shots.spec.ts

| | Light | Dark |
| --- | --- | --- |
| Thread | `before-thread-light.png` → `after-thread-light.png` | `before-thread-dark.png` → `after-thread-dark.png` |
| Main | `before-main-light.png` → `after-main-light.png` | `before-main-dark.png` → `after-main-dark.png` |

`accents/` has the panel alone in each of the eight accents, in both themes (after only).

## What changed

- **Catch me up is gone.** No chip, no plumbing for it (`catchUpDoneAtom`, the panel's `sendRef`). Typing "catch me up" still works, and a panel message still carries where the topic's "new" divider was.
- **Context chip.** The loose line above the composer, which sat at a different inset from the field, is now a 24px pill chip inside the top of the field. Its left edge is on the field's text, 8px below the field's top border and 8px above the text's line box; its 12px corners are concentric with the field's 20px corner. A selection is a second chip with an x; Ask Juno's About chip replaces the topic chip. Long names cut with an ellipsis (gallery `Workspace/page/juno-panel-long-name`, checked by `apps/gallery/juno-panel-geometry.spec.ts`).
- **Opens at the bottom.** Before, the newest exchange was below the fold on open (only its "About" line showed). Each chat row is `content-visibility: auto` at a 38px estimate; the bottom was set before paint, then the rows in view grew to their real height and pushed the end down. The last screenful of rows is now laid out in full, as the topic list does. `chat.spec.ts` "the panel opens at the newest message on its first frame" checks ten painted frames after ⌘J; on origin/main every frame failed, on this branch all pass.
- **Panel colour.** Before, the panel was `--surface-default` with 1.5% of the accent: in light almost the page colour with a pink cast, in dark a reddish grey, and in both the composer field and the panel were the same colour. Now `--panel-surface` has no accent: #F6F5F1 in light (a step below the page, 1.05:1), #201E1B in dark (a step above it). Juno's bubbles on it take `--panel-bubble` (lighter than the panel in light), so they and the field read on it. Muted text is 4.7:1 in light and 6.2:1 in dark.

## Looked at

- Light: the panel reads as a quiet grey pane beside the warm page, separated by its shadow, not by a border. The white field and bubbles stand off it.
- Dark: neutral, no red cast. The field is lighter than the panel and keeps its border.
- Accents: the panel itself never changes; only the owner's bubbles, the send button and the focus ring take the accent.
