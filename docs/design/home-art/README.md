# Home's picture, its story and the gallery

When Home is caught up, a picture takes the caught-up scene's place: a painting, a print, a nature study, or an image from Hubble, Webb or another NASA mission. Clicking it opens the picture larger with its story. The gallery is a page that shows every picture. SPEC section 12, "A picture" and "Pictures and the gallery", decides the behaviour; this folder holds the design and the reasons for it.

Files:

- `mock.html`: the mock. Open it from this folder (`file://` works; the fonts are in `fonts/`, the sample pictures in `img/`).
- `home-day.png`, `home-night.png`, `home-portrait.png`: Home caught up, light and dark, by day and late at night, and with a tall picture.
- `story.png`, `story-narrow.png`: the picture page with its story, and the same page in a narrow window.
- `gallery.png`: the gallery, light and dark.
- `render.mjs`: re-renders the PNGs (`node render.mjs` from this folder).

The mock and its PNGs predate the two-line caption: they still show a one-line plaque and a thought under it. This text and SPEC 12 decide.

## Why a picture, and why only here

Home is the one place in Juno where there is nothing to do. A picture there is something to look at while you have a minute, and its story is something to read if you want to. Work surfaces (a topic, the sidebar, the composer, the Juno chat) get no art: there it would compete with the work.

## Home

![Home, caught up, by day](home-day.png)

- **Where.** In the caught-up scene's place. Only a caught-up Home shows a picture; a Home with rows, or one waiting on the first sync, keeps its scene and its greeting.
- **The picture and its caption, nothing else.** With a picture, Home does not say "All caught up.": the picture says it, and the 36px serif line under it crowded the picture. Nor does it show a quote or fact: text under an image reads as being about the image, so a quote under a Monet looked like a comment on it, and two unrelated captions on one calm page asked to be read and related to each other. The quotes and facts live in the gallery instead. The block is centred in the space above the composer. A hidden heading, "Home", names the page for screen readers. Without a picture on disk, or with the picture turned off, Home shows the scene and "All caught up." as before.
- **A fixed box.** 320 by 216, the same for every picture, so the caption is always in the same place. The picture is fitted inside it and sits on the box's bottom edge, so a wide picture and a tall one both rest on the line under them. Nothing in the column depends on the picture's shape.
- **No frame.** A thin edge and a soft shadow, as a print hung on a wall. A drawn frame or a mat looked like a skeuomorphic widget at this size and made the column busier; the shadow is enough to separate it from the page. In dark the shadow is deeper and the edge is a faint light line, so a dark space image still has an edge.
- **The caption.** Two lines, 12 under the box, centred: the title, then a smaller muted line with the artist and the date ("The Beach at Sainte-Adresse", then "Claude Monet, 1867"; for a space image "James Webb Space Telescope, 2022"). The thing first, one quiet line under it. The title is the UI role (Figtree 13.5, medium, `--foreground-default`) and the second line the meta role (Figtree 12.5, `--foreground-muted`), the caption a gallery tile has, so Home's picture reads as a work you can open. Not the serif: Instrument Serif is a condensed display face drawn for 30px and up; at a caption's size it is thin and reads smaller than its size, and at 30px a painting's name becomes a heading on a page that should be quiet. Each line is one line, never wider than the box: a long title ends in an ellipsis with the whole title as its tooltip, so the caption is never three lines and nothing moves between pictures.
- **Size.** The scene is 120 by 83; the picture box is about 2.7 times its width. At 320 a painting is big enough to see, and the column fits a window about 560 tall at the full 216 with the composer. On a shorter window the box gives up height, down to 144, so the column still fits above the chip and the field; the size depends on the window, never on the picture.
- **Only from disk.** The picture shows only when it is already on this Mac. Otherwise Home shows the caught-up scene, as it does today. So Home never waits for the network and never fills in a picture after its first frame. The small picture is read from disk; the box is there in the first frame and the picture appears in it without moving anything.
- **Shape.** A panorama or a very tall picture would be a thin strip in the box, so Home takes only pictures between 0.55 and 2.6 times as wide as high; the gallery shows them all.
- **Night.** Late at night (22:00 to 4:59, the scene rule's night) the next picture is a space image while one is left that has not been shown.
- **Interaction.** The picture is a button ("Open The Beach at Sainte-Adresse"). Hover deepens the shadow; press shows in the next frame; focus shows the ring. A plain click opens the picture page in the tab, so Back returns to Home; ⌘-click opens it in a new tab.

Rejected: "All caught up." between the plaque and the thought (the first build; Tushar found it spoiled that part of the screen); a quote or fact under the caption (the second build: two captions with two grammars, and the quote read as a comment on the picture); one line "Title · Artist, date" (it overhung the box for space images, and two lines read more calmly); a full-bleed or blurred wallpaper behind the greeting (SPEC 12 keeps Home calm, and text over a painting needs a scrim that changes with every picture); a picture beside the greeting (needs a breakpoint, as variant B in `docs/design/home/` did); a picture under the thought (the composer's Recent sits there, and it moved the greeting with every picture's height).

## The picture and its story

![The picture page](story.png)

The picture page opens in the tab. The picture fills the left of the page at the largest size the page allows, on the page's own background, with the same edge and shadow. On the right, a 380px column reads like a museum label:

1. **All pictures** (back to the gallery) and **‹ ›**, the previous and next picture in the gallery's order. ← and → do the same.
2. The title in the serif, the artist (with the culture when there is one, "Pahari, Tehri Garhwal"), then the date and medium, then where the picture is ("Musée Marmottan Monet, Paris"; for a space image, what and where it is, with its distance).
3. The caption, one sentence in the serif at 18 (the Thought role): what the picture is.
4. Three to five facts, the best first. What it is and how it was made, what was surprising or argued about at the time, what you would miss at first glance; for a space image, what you are looking at, how big and how far, what the colours stand for.
5. The credit line (the licence and where the picture comes from, and for a CC BY image the credit its publisher asks for), and **Sources**, a quiet numbered list of each fact's source with its link.

Text is selectable. The facts are a list, so a screen reader announces how many there are. The small picture shows at once, scaled, and the large one replaces it when it is on disk, in the same box, so nothing moves. In a window narrower than 900px the story goes under the picture and the page scrolls (`story-narrow.png`).

The tab shows the picture's title with the gallery icon.

## The gallery

![The gallery](gallery.png)

A page of its own, like All topics: "Gallery" in the greeting serif, one line on what it is, then All, Paintings, Prints, Nature and Space with their counts, and a step apart Quotes and Facts with theirs, then the pictures in sections in that order. Each section lays its pictures out in rows of one height, each at its own shape, the way pictures hang on a wall, with the title and "artist, date" under each in one line. The picture Home showed last has a thin ring. A click opens the picture page in the tab; Back returns to the wall where it was.

Pictures not yet on this Mac are fetched as they come near the screen. Until one lands its box shows in the secondary fill at the picture's shape, so the rows never move.

### Quotes and facts

The quotes and facts that Home used to show under its greeting are words to read when you want to, so they live here. **Quotes** and **Facts** are pills after the kinds, set apart by a step of room, because they are not pictures: All stays every picture, so the wall is never a mix of images and long text. Quotes and facts are separate pills because they read differently: a quote is a voice, so it shows who said it; a fact is a statement, so it names no one.

Each pill shows its entries in sections by theme (Focus and craft, Thinking deeply, Wonder at the universe, Life, Things made, Art and beauty), with the same muted section labels as the picture kinds. The type is the picture page's, so the gallery's words read as the stories do: a quote in the serif at 18 (the Thought role, `--foreground-default`) with who said it under it in the meta role and `--foreground-muted`, no dash; a fact in the body role in `--foreground-secondary`, as the story's facts. Entries sit in columns at least 290 wide that share the page's width evenly, with the picture rows' 20 gap between them, so a wide window never leaves empty space between columns: two at 1200 wide with the sidebar shown, three at 1440 and 1600, four at 1920. With two or more columns a line is about 45 to 75 characters (a quote's serif averages about 6 px a character, a fact's body text about 6.5); a single column, on a narrow window, stops at that same width. Sources are kept in the list and never shown, as everywhere. The list is its own chunk (`@juno/pictures/thoughts`), loaded with the gallery.

How to get there: the picture page's **All pictures**, ⌘K ("Gallery"), and **Open the gallery** beside the setting in Settings › General. No sidebar item: the gallery is something to visit now and then, and the sidebar's title bar is for things used every day.

## Writing the stories

Plain, concise English, as SPEC section 17 and `CLAUDE.md` ask. The wonder comes from the facts, not from adjectives: no "stunning", no "masterpiece", no metaphors, no exclamation marks. Every fact is true and has a source that states it (a museum's page, a catalogue, a NASA or ESA release, a book); a fact we cannot source is left out. Popular myths stay out.
