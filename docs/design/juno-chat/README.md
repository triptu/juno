# Juno chat: the bubble mock

`mock.html` is the agent chat as SPEC §13 describes it, four times over, with only the owner's bubble changing. Open it from this folder (`file://` works; the fonts come from `../home/fonts/`). `node render.mjs` writes the PNGs with Playwright from the gallery's dependencies.

| File | What |
| --- | --- |
| `mock-light.png`, `mock-dark.png` | The same transcript in each option: a two-bubble group, a reply with a citation, a Send card, a failed send, a remembered line, a Task card, the status bubble with text, a streaming reply, and the composer. The last column is the quiet state. |
| `accents-light.png`, `accents-dark.png` | Option A under each of the eight accents, since the accent is a user setting. |
| `rhythm-light.png`, `rhythm-dark.png` | Forty generated messages in options A and C, for the review finding that three bubbles do not show whether the colour wears. |

Everything in the mock uses token values from `packages/tokens/src/tokens.stylex.ts` and `themes.stylex.ts`: Figtree, the warm paper and the near-black palette, Coral's light and dark fills, `--radius-bubble` 16 with the 4px tail, `--radius-card` 20, `--card-ring` (the soft shadow in light, the ring in dark), `--radius-composer` 20.

## The options

| | Owner bubble | Text | Light | Dark |
| --- | --- | --- | --- | --- |
| A | The accent fill, `--hl` | `--hl-fg` | #CC4628 / white | #FF8A73 / #2A0D06 |
| B | A tint of the accent over the page, 16% light and 22% dark | `--foreground-default` | pale coral | muted brick |
| C | The neutral tint, `--secondary-default` | `--foreground-default` | warm grey | warm grey |
| D | Ink, `--accent-default` | `--accent-foreground` | near-black / paper | paper / near-black |

Juno's bubbles are `--surface-hover` in every option, with the seated j beside the last bubble of a group.

## Recommendation: B, the accent tint

- **A wears badly.** At three bubbles the coral fill reads as iMessage blue. At forty (`rhythm-light.png`) half the screen is saturated coral, and the chat is the loudest surface in an app whose rule is calm by default. In dark the pale fill glows. Under Marigold the fill is 1.9:1 against the page and the bubble is the largest accent area in the app. A also puts coral in three places at once: the bubbles, the Send button and the send arrow.
- **C cannot be told apart.** `--secondary-default` and `--surface-hover` are two steps of the same grey (92% and 94% in light; #302F2C and #2D2B28 in dark). Alignment is then the only signal of who said what. That is the weakest reading of a two-party chat.
- **D is A without the hue.** Strong, and it makes the owner's words the heaviest thing on screen. It also collapses into A when the accent is Ink, so it is not a separate option in the product.
- **B keeps the signal and drops the volume.** The hue says "mine", which is what `--hl-soft` already means in the app (the tint behind a message that mentions you, the @you chip). The text stays `--foreground-default`, so contrast comes from the page and holds for every accent without a per-accent foreground. Over forty messages the chat stays paper with a warm rhythm. In dark the mix reads as a muted brick, with no glow.

If the owner wants a bolder chat, A is the answer and the mock shows it is workable; the cost is the rhythm sheet.

Built (WP12): `--hl-bubble` is in every accent theme (16% light, 22% dark; Ink 12% and 14%), and the `chat` token group's `--owner-bubble-bg` / `--owner-bubble-fg` point at option B. Switching options is a change to those two lines in `packages/tokens/src/tokens.stylex.ts`. The gallery's `OwnerBubble` "compare-a-to-d" state renders all four options through the real component, in light and dark.

## Also seen in the mock

- The citation underline in `--foreground-muted` is enough to read as a link inside a bubble; a blue link would fight the bubble.
- The status bubble with text beside the dots reads as one row. (The mock also shows Stop to its right; the chat no longer has Stop, decision log 10-14 11:50.) The streaming bubble's thin caret is a mock detail; the view shows no cursor.
- Cards at full column width under a 76% bubble look right in light. In dark the ring separates the card from the page; the light shadow would vanish there, as the review said.
