# Attachments polish, 2026-10-15

Four items from the owner after attachments landed, on `attachments-polish`. Each pair is `<component>-<group>-<state>-<theme>-before.png` (main) and `-after.png` (this branch), from the gallery at device scale 2, so every length in a shot is twice the CSS length. Lengths below are CSS px, measured in the browser; `apps/gallery/geometry.spec.ts` holds each to the pixel.

## Message images

The "720px" landscape image was 360 CSS px wide (the shots are 2×). The portrait was 180 × 280. Several images in one message stacked, each at full size.

- One image: capped at 360 × 240 (`--thumb-max-height` was 280). Landscape 16:9 is 360 × 203, the portrait 154 × 240.
- Images next to each other: a two-column grid 360 wide, every cell 177 × 120 with the image covering it, gap 6. Cards still go one per line.
- The box is sized before any bytes arrive, as before, so nothing moves while images load. The viewer opens at the image's own size (`ImageViewer-open-*`, unchanged).

See `MessageList-Files-thumbnails-*`, `-focus-thumbnail-*`, `-downloads-*`.

## Composer inset

Before, measured from the field's inner edge: check bar 8, chip row 6, attach button 6, typed text 42. The check bar was also 8 from the end, while the send button was 6.

Now everything inside the field shares one 6px inset: the audience line, the check bar, the chip row, the attach button (start) and the send button (end). The notices are 6 from the top and 6 apart, and radius 14 like the chips (the field's 20 less 6). The typed text cannot share this edge, because the attach button sits in front of it; it starts at 42, as before.

See `Composer-attachments-check-bar-with-chips-*`, `-with-chips-*`, `Composer-checks-audience-and-check-*`.

## Chips

The image chip had no border and its remove button showed only on hover; the file chip had a border and a muted remove button centred at its end.

Now both are the same 44px frame, radius 14, with a 1px `--border-default` border drawn over the content. An image is the picture filling that frame. Both have the same remove button, 20px round raised, always shown, 4px from the top and end edges (its 10px radius is concentric with the chip's 14). A file chip's icon tile is 6px from its start, top and bottom, and the name stops 4px before the remove button.

See `AttachmentChips-state-*`.

## This Mac chip

Before: the "Active here" chip ended 15px from the card edge, but the Move and Restore text ended 24px from it (the buttons end at 15, and their text is 8px padding and 1px border further in). That is the 17 device px the owner saw.

Now the chip ends at 24, with the button text. The Codex card has no text buttons, so its "Ready" chip stays at 15, with the values and fields of the cards above it ($0.35, the Daily cap field). A version that moved it to 24 was tried and looked wrong there.

See `ThisMacSection-this-mac-*` and `JunoSettingsPage-settings-ready-*`.
