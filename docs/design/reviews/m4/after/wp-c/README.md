# WP C after shots

Gallery shots of the message components before and after the WP C fixes (B3, S5, S6, S8, N4), light and dark, from `GALLERY_SHOTS_ONLY=Message,MessageList,ThreadLink,CodeBlock pnpm gallery:shots`.

- `before/`: at `cbe20cc`, the merge the fixes were made on.
- `after/`: at the head of `m4-fix-c`.

States added by WP C, so they have no `before`: `Message--row--long-name` (a cut-off sender name; the tooltip is the browser's own and is not in the shot, `apps/gallery/behaviour.spec.ts` checks it), `Message--interaction--hover-toolbar-long-line` and `hover-toolbar-continuation`, `MessageList--interaction--hover-toolbar-long-line`, `MessageList--content--long-code`.

The `Message` states are wider after than before: a lone row now fills its frame as it fills the list column, so the names truncate as they do in the app.

## S8 and the feel suite

The code block fix was first tried as a full-height block. `pnpm test:feel` then failed its long-thread scroll check (`scroll-long-thread: the message list does not flicker`), and passed with only that change reverted, so the shipped fix keeps the 150px scroller and drops `overscroll-behavior: contain`. The check fails with that too, and the reason is in the frames: on the base commit the wheel is trapped by the code block that passes under the pointer, so the list stops scrolling at frame 172 of 340 and sits still for the rest of the scenario, which is the S8 bug itself. With the trap gone the list keeps scrolling, and twice during the scroll up (frames 176 and 208) everything below one row moves down one pixel for one frame and back. The base commit with only the `overscroll-behavior` line removed fails the same way at the same frames, so the wobble is in the list's scroll handling, not in this package's changes. It is left for the owner of the message list's position logic.

The `after/` shots of `MessageList--content--long-code` and `MessageList--content--hostile` show the capped block.
