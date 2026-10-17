# The second tour: three directions

The owner picked C on 2026-10-17. It is built as the welcome card (SPEC 4, "The welcome"; inventory 1.2). The built card fits the minimum window: there, Home hides its scene and greeting and shows one row while the card shows.

The first tour spent two of its five steps on how topics work, and its numbered rings made each picture a diagram to decode. These directions lead with what you get: Home, peek, tabs, the app tidying itself, and Juno, which sends nothing until you click. Topics get one line, as a benefit.

The shots come from the gallery (`TourDirections` in `packages/views/src/tour/TourDirections.fixtures.tsx`) and use the real views with fixture data. Each is in light and dark. They show the sidebar as it was on 2026-10-17. Home's move to a title bar icon (`home-icon`) and the settled card's reasons (`settled-suggestions`) will show in the built tour's pictures, because `pnpm tour:shots` shoots the real views.

## A. Short and calm

A sheet over the app with four steps. Each step has one large picture, a headline and one sentence, and no rings. A picture shows only the part of the app the step is about (`a-1-home` … `a-4-tidy`, `a-over-app`).

1. **One calm place to start.** Home shows the few things that need you. Write to anyone, or ask Juno, from the field at the bottom.
2. **Read without opening.** Hold ⌥ over a topic or a message to read it. Let go, and it stays unread.
3. **Keep several things open.** Conversations open in tabs, like a browser. Every thread is its own conversation, so nothing gets buried.
4. **Juno tidies up, you decide.** Settled topics are offered for Resolve, and bot channels move to Automated. Juno sends nothing until you click.

## B. Show, don't tell

The same sheet and steps, but each picture is a short demo with the key it shows written under it. The peek demo opens while you hold ⌥ in the sheet, and plays on a slow loop until you try it. With reduced motion, each demo shows its last frame (`b-1-home` … `b-4-juno`, and the frames in `b-frames-*`).

1. **What needs you, in one place.** Home fills with what is waiting on you, and nothing else. Type to ask Juno, or start with @ to write to someone.
2. **Hold ⌥ to peek.** Try it now. The topic opens beside the list, and closes when you let go, still unread.
3. **Open a second tab.** ⌘-click a topic to keep it open beside this one. Every thread is its own conversation, so nothing gets buried.
4. **Juno asks before it acts.** Ask it to catch you up or draft a reply. It offers settled topics for Resolve, and sends nothing until you click.

## C. Land and learn

No sheet. The first Home after sign-in has a small card under its rows, just above the field it points to. Each hint ticks off when you do it (`c-fresh`, `c-one-done`, `c-all-done`, `c-minimum-window`, `c-card`).

**Three things to try** · Hide

- Hold ⌥ over a topic to read it without opening it
- ⌘-click a topic to open it in a new tab
- Ask Juno something in the field below

Once all three are ticked, the heading says "You're all set" and Hide becomes Done. Home's own rows cover tidying: a "3 topics look settled" row with its reasons, and "Move #releases?". On a short window, the scene gives its room to the card. At the minimum window, 720 × 480, the card still sits partly below the fold, and the build has to fix that.
