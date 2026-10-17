# Home merged with New chat, round 5: built

The owner picked round 4's layout B (Recent just above the composer, on its left edge) and asked for one change: the destination leaves the field. A chip inside the field left empty space under it once the text wrapped.

The chip now sits on its own line between Recent and the field, on the field's left edge. The field's text has its full width. Recent, the chip and the field read as one stack: 12px under Recent, then the chip, then 8px to the field, so the chip labels the field it sends from. The chip's place is always there; a new destination's name rises 4px into it with a fade over `--duration-fast` (a fade only under reduced motion), and nothing else moves.

These shots are the proposal fixture made before the build (light and dark):

| State | File |
| --- | --- |
| Items waiting | `items-waiting-{light,dark}.png` |
| Caught up | `caught-up-{light,dark}.png` |
| Writing to Maya, one line | `writing-{light,dark}.png` |
| Writing to Maya, three lines | `writing-multiline-{light,dark}.png` |
| The `@` list open | `at-person-{light,dark}.png` |
| Narrow, 560 | `narrow-{light,dark}.png`, `narrow-caught-up-{light,dark}.png`, `narrow-multiline-{light,dark}.png` |

The built Home's states are in the gallery under `Home` (`Write`, `Items`, `Empty` and `Interaction`), and the sidebar's title bar with All topics under `Sidebar` (`Nav` and `Tooltips`). SPEC §12, "Writing", and inventory §8 describe what was built.
