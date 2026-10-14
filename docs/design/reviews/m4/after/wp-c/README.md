# WP C after shots

Gallery shots of the message components before and after the WP C fixes (B3, S5, S6, S8, N4), light and dark, from `GALLERY_SHOTS_ONLY=Message,MessageList,ThreadLink,CodeBlock pnpm gallery:shots`.

- `before/`: at `cbe20cc`, the merge the fixes were made on.
- `after/`: at the head of `m4-fix-c`.

States added by WP C, so they have no `before`: `Message--row--long-name` (a cut-off sender name; the tooltip is the browser's own and is not in the shot, `apps/gallery/behaviour.spec.ts` checks it), `Message--interaction--hover-toolbar-long-line` and `hover-toolbar-continuation`, `MessageList--interaction--hover-toolbar-long-line`, `MessageList--content--long-code`.

The `Message` states are wider after than before: a lone row now fills its frame as it fills the list column, so the names truncate as they do in the app.

S8, the code block, was first fixed by laying the block out in full. `pnpm test:feel` then failed its long-thread scroll check on every run (the list moved one pixel for one frame, twice, during the scroll up) and passed again with only that change reverted, so the shipped fix keeps the 150px scroller and drops `overscroll-behavior: contain`. The `after/` shots were taken with the full-height block; `MessageList--content--long-code` and `MessageList--content--hostile` show the block capped at 150px in the current code.
