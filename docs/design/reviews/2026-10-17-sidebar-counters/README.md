# Sidebar counters in the accent, 2026-10-17

The owner's note: "let's use the accent color with reduced brightness for counters on the left side. it's almost invisible rn otherwise." The grey count tags on the rows and on the Juno nav item now take the accent at reduced brightness.

- **Tokens.** `--hl-count` (fill) and `--hl-count-fg` (text) for each accent, in light and dark (`docs/design/tokens.md` 1.3, with every value and its contrast). The fill is a pale tint of the accent over the sidebar. The text is the accent's own hue: deeper in light, dimmed in dark. Text is at least 4.5:1 on the fill in every accent: 4.67 to 11.5:1 in light, 5.03 to 5.16:1 in dark.
- **Where.** Every sidebar counter: the row unread count and Juno's count, through `Chip variant="count"`. The quick filters show no counts, only the unread dot, so they are unchanged. Counts outside the sidebar (the topic switcher) stay grey.
- **Ink** stays neutral, as it does everywhere.

Each tile is `Sidebar` › Nav › `juno-unread` in one accent: Juno's count, then the row counts.

Light:

![](all-light.jpg)

Dark:

![](all-dark.jpg)

One file per accent and theme is beside this README (`coral-light.jpg`, `coral-dark.jpg` and so on).
