# Home's picture, its story and the gallery

When Home is caught up, a picture takes the caught-up scene's place: a painting, a print, a nature study, or an image from Hubble, Webb or another NASA mission, with its label and one line of words about it. Clicking it opens the picture larger with its words. The gallery is a page that shows every picture with its line. SPEC section 12, "A picture" and "Pictures and the gallery", decides the behaviour; this folder holds the design and the reasons for it.

Files:

- `mock.html`: the mock. Open it from this folder (`file://` works; the fonts are in `fonts/`, the sample pictures in `img/`).
- `home-day.png`, `home-night.png`, `home-portrait.png`: Home caught up, light and dark, by day and late at night, and with a tall picture.
- `story.png`, `story-narrow.png`: the picture page with its story, and the same page in a narrow window.
- `gallery.png`: the gallery, light and dark.
- `render.mjs`: re-renders the PNGs (`node render.mjs` from this folder).

The mock and its PNGs predate the wall text: they show a smaller picture with a different caption. This text and SPEC 12 decide.

## Why a picture, and why only here

Home is the one place in Juno where there is nothing to do. A picture there is something to look at while you have a minute, and its story is something to read if you want to. Work surfaces (a topic, the sidebar, the composer, the Juno chat) get no art: there it would compete with the work.

## The picture and its words: a wall text

Each picture comes with three things that always go together, as on a museum wall: the picture, its label (title, artist or mission, date: what it is), and its line (one quote by someone with a real tie to the picture, or one fact that makes you look again). Home shows all three; the picture page adds a short paragraph, how big or how far, and one link; the gallery shows the label and the line under each picture.

Why: the first builds showed a picture with only its label, and nothing said why this picture. An earlier build put an unrelated quote under the picture, which read as a comment on it, so the quotes and facts moved to their own gallery pills, far from the pictures they were about. Six concepts were mocked in round 1 (wall text, book spread, look closer, words first, scale and time, the plaque); Tushar chose the wall text, with scale and time on the picture page and a timeline view in the gallery. The standalone quotes and facts went: a line that belongs to its picture says more than a list of lines that belong to nothing.

## Home

![Home, caught up, by day](home-day.png)

- **Where.** In the caught-up scene's place. Only a caught-up Home shows a picture; a Home with rows, or one waiting on the first sync, keeps its scene and its greeting.
- **The picture leads.** Round 2 found the line pulling more attention than the picture when it was set at 22 under a 320 box. The box is now 440 by 300 and the line is the serif at 18 in `--foreground-secondary`, so at 1200 by 800 a 1.29 painting is 387 by 300, about four times the area of the label and the line together, and the highest-contrast thing on the page.
- **It sits on the page.** A firm thin edge drawn over the picture and a layered shadow (a hairline, a contact shadow, two wider soft ones) under it, deeper under the pointer: `--picture-home-edge`, `--picture-home-shadow`, `--picture-home-shadow-hover`. In dark the edge is a faint light line and the shadows are deeper, so a dark space image still has an edge. No frame or mat: at this size a drawn frame looked like a widget.
- **A fixed box.** The same for every picture, so the label is always in the same place. The picture is fitted inside, whole, never cropped, and sits on the box's bottom edge. On a shorter window the box gives up height, down to 160, so the column still fits above the chip and the field; the size depends on the window, never on the picture.
- **The label.** One line, 16 under the box, centred, in the meta role: the title in the subtle tone, then " · " and the artist and the date in the muted tone ("Impression, Sunrise · Claude Monet, 1872"). Never wider than the box: a long label ends in an ellipsis with the whole label as its tooltip. Not the serif: at a label's size Instrument Serif is thin and reads smaller than its size.
- **The line.** 10 under the label, the serif at 18, centred, `text-wrap: balance`, at most the box's width. A quote in curly quotes with its speaker run in after it in the meta role ("…water-view!” Louis Leroy"); a fact as it is. One serif role for both, so a quote and a fact share one grammar. At most about 140 characters, so two lines; the line hangs under the label, so a longer line never moves the picture.
- **Only from disk.** The picture shows only when it is already on this Mac. Otherwise Home shows the caught-up scene. So Home never waits for the network and never fills in a picture after its first frame. The label and the line are saved with the next picture, so Home has them without the catalog. A saved picture from before lines existed is dropped, and Home shows its scene until the next picture is ready.
- **Shape.** A panorama or a very tall picture would be a thin strip in the box, so Home takes only pictures between 0.55 and 2.6 times as wide as high; the gallery shows them all.
- **Night.** Late at night (22:00 to 4:59, the scene rule's night) the next picture is a space image while one is left that has not been shown.
- **Interaction.** The picture is a button ("Open Impression, Sunrise"). Hover deepens the shadow; press shows in the next frame; focus shows the ring. A plain click opens the picture page in the tab, so Back returns to Home; ⌘-click opens it in a new tab.

Rejected: "All caught up." between the picture and its words (Tushar found it spoiled that part of the screen); an unrelated quote or fact under the picture (two captions with two grammars, and the quote read as a comment on the picture); the line at 22 under a 320 box (it outweighed the picture); a detail crop instead of the whole picture (hides what the picture is); a full-bleed or blurred wallpaper behind the greeting (text over a painting needs a scrim that changes with every picture); a picture beside its words (needs a breakpoint, as variant B in `docs/design/home/` did).

## The picture page

![The picture page](story.png)

The picture page opens in the tab. The picture fills the left of the page at the largest size the page allows, whole, on the page's own background, with the gallery's edge and shadow. On the right, a 380px column reads like a museum wall text:

1. **All pictures** (back to the gallery) and **‹ ›**, the previous and next picture in the gallery's order. ← and → do the same.
2. The title in the serif, the artist (with the culture when there is one, "Pahari, Tehri Garhwal"), then the date and medium, then where the picture is ("Musée Marmottan Monet, Paris"; for a space image, what and where it is).
3. The line, in the serif at 24: the voice of the page. Under it, in the meta role, who said it and a short clause of where and when ("Louis Leroy, in Le Charivari, 25 April 1874, of this picture. He meant it as mockery; the painters took the name.").
4. The about: two to four plain sentences in the body role. No bullets.
5. Where the picture has a scale, **How big** or **How far** (below).
6. At the foot, one link labelled with the institution ("Musée Marmottan Monet", "NASA"), with an arrow, never the address; it opens the page in the browser, so it has the pointer cursor. Under it, the credit line in the muted tone (for a CC BY image, the credit its publisher asks for). Line sources stay in the catalog and are not shown.

Text is selectable. The picture's caption is its alt text. The small picture shows at once, scaled, and the large one replaces it when it is on disk, in the same box, so nothing moves. In a window narrower than 900px the words go under the picture and the page scrolls (`story-narrow.png`).

**How big** draws the artwork to scale beside a person 170 cm tall, both standing on one line, in an SVG measured in centimetres, so a 48 × 63 cm canvas and a 379 × 453 cm one both fit the 120 high drawing. "48 × 63 cm, beside a person 170 cm tall" under it. **How far** is a line from Earth on a log scale, with the Moon, the Sun, Neptune, the nearest star, the Milky Way's centre and Andromeda marked, names alternately above and below so neighbours never touch, and the picture's place as a dot. Under it, "About 7,600 light-years away." and the picture's note, or else how long its light took (light-years give years; for Earth seen from far away, "Light from there takes about 6 hours to reach Earth."). Each appears only where the catalog has the number; nothing is reserved otherwise. Round 1's "When" timeline and "That year" list were left out: the first repeats the date, the second drifts into trivia.

The tab shows the picture's title with the gallery icon.

## The gallery

![The gallery](gallery.png)

A page of its own, like All topics: "Gallery" in the greeting serif, one line on what it is, then All, Paintings, Prints, Nature and Space with their counts, and at the end of that row **By kind** and **By time**.

- **By kind**, the default: sections by kind, each in columns at least 200 wide that share the page's width (three at 1200 with the sidebar, five at 1600, six at 1920). Each picture is whole at its own shape, with its label and its line under it, as on Home. Each goes in the shortest column so far, worked out from its shape and the length of its line before any image loads, so nothing moves when the files land. Columns rather than rows of one height, because each picture now carries a line of its own length.
- **By time**: sections by century, oldest first, each century a row of its own: a heading over a rule across the page, then its pictures at one height, wrapping, each with its title (up to two lines) and "date · artist" under it. It shows the gallery's own line, a thousand years of pictures, better than the kinds do; space images land in the 1900s and 2000s with everything else. The first build set small centuries side by side with only the date under each: the rules came out at uneven lengths, the rows looked ragged, and dates such as "second half 9th–mid-10th century" were cut mid-word with nothing to say what the picture was.

The pills filter both views. The picture Home showed last has a thin ring. A click opens the picture page in the tab; Back returns to the wall where it was, in the same view. Pictures not yet on this Mac are fetched as they come near the screen. Until one lands its box shows in the secondary fill at the picture's shape, so nothing moves.

How to get there: the picture page's **All pictures**, ⌘K ("Gallery"), and **Open the gallery** beside the setting in Settings › General. No sidebar item: the gallery is something to visit now and then, and the sidebar's title bar is for things used every day.

## Writing the words

Plain, concise English, as SPEC section 17 and `CLAUDE.md` ask. The wonder comes from the facts, not from adjectives: no "stunning", no "masterpiece", no metaphors, no exclamation marks in our own words. The line observes and never advises: no imperatives, no "you", no motivation. A quote is verbatim from a page someone loaded, with its speaker and source; a fact is true, dated where it can be, and has a source that states it (a museum's page, a catalogue, a NASA or ESA release, a book). Something we cannot source is left out, and so are popular myths. The about is two to four sentences on what is in the picture and how it was made, shown or received, and never repeats the line. The link to read more is the holding museum's page for the object or the mission's release, labelled with the institution. Sizes are the museum's stated dimensions; distances come from the release, and light travel time is worked out from them.
