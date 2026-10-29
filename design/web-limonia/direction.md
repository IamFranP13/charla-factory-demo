# How this design was made (taste-skill v2, MIT)

Method: [taste-skill](https://github.com/leonxlnx/taste-skill) by leonxlnx, run for a **page** (`draw.mjs`, `inspect.mjs`, `lint.mjs`, `references/critique.md`), plus its **app screen** rules for the calculator fragment (`draw.mjs --app --kind commerce`, `inspect.mjs --app` on pages 03 and 04). Brand colours kept (`brain/marca.md`); everything else is new.

## Direction

- **Dealt** (`draw.mjs --sector other --keep palette --options 3`): `borrowed-category`, `one-motif`, `type-only-statement`. A first deal with `--tone warm` had offered `one-motif` and `page-is-the-object`.
- **Chosen: `one-motif`** (full sheet seed 654265746). Why: the name LIMONIA is the lemon and the lemon cut open is a disc with a hub and radiating segments, the simplest shape in the subject, which then becomes a hero field, a photograph mask, a button, a bullet, a progress dial and the block mark of the footer. `page-is-the-object` (a crate label or delivery note) was the runner-up, kept only as the crate-label stripe of the hero card; `type-only-statement` and `borrowed-category` would have thrown away the real photographs of the huerta.
- **Idea:** *On this page, LIMONIA's own lemon, cut open, becomes one disc that runs the whole site.* Competitor test: a competing Murcia exporter also sells lemons, so the idea leans on the name and on the live use of the disc (the progress of a request is a segment of the lemon); it is passable, not unique. **Live thing:** the quote total recalculating with the real prices, discount tiers and transport tariffs (page 03), and the request that fills a segment of the dial (page 04).
- **Redraws:** the dealt type system (League Spartan / Figtree) is kept (both OFL, self-hosted instead of the dealt Google Fonts `<link>`); the dealt hero ("Striped card beside the room") is adapted: the right half is the lemon field instead of one full-height photograph, because the direction's own composition asks for the motif at enormous scale in the hero; the dealt "mountain" photo set is not used, real pictures of the huerta are (assets.mjs). The `stats`, `showcase`, `list`, `how-it-works`, `cta` and `footer` blueprints were adapted to the real content (three figures, N campaigns, ten products, five stations, the request form, the credits).

## Words (argument, one line per section)

1. Hero: LIMONIA sells fruit from Murcia to your warehouse; calculate a quote or see the catalogue.
2. Figures: 9 products available, 6 destinations, 2 days to the first one (computed from `catalogo/`).
3. Campaigns: what is on offer now (`content/campanas/`).
4. Featured products: what it costs per kilo (`data/precios.json`).
5. From your request to the web: how the factory changes the site.
6. Ask for a change: the form (≤ 150 characters) and your requests.

## Inspector (final run, widths 1920 / 1440 / 1280 / 1024 / 768 / 390)

| Page | FAIL | WARN (defended) |
|------|------|-----------------|
| `01-inicio.html` | 0 | `palette-cream` (the brand's warm whites), `no-footage` (no honest clip of reasonable weight; the cut lemon turns slowly instead), `mixed-font-headline` @1024 (price blocks pair League Spartan with the unit in Figtree) |
| `02-catalogo.html` | 0 | `palette-cream`, `no-footage` |
| `03-presupuesto.html` (`--app`) | 0 | `palette-cream`, `below-fold`, `panel-void` (the footer mark's block letters), `app-title-size` (site h1), `colour-sprawl` (the lemon disc on a phone) |
| `04-tarea.html` (`--app --allow icon-chips`) | 0 | the same, `icon-chips` allowed: the state marks (done / now / stopped) are data, not decoration |

`lint.mjs`: 0 FAIL; WARN: 1px frame of the calculator sheet (`data-ui`), five em dashes used as the "no value" mark.

First runs, before the fixes: emoji of the content (removed from the display), white text on a `lemon` button (a CSS variable override), accordion labels covered by the sticky header (labels made horizontal), 14px "body" caused by the credits paragraph (split into short lines), captions read as eyebrows above headings (moved onto solid chips, bigger section gaps), `ink` text on `oliva` in the mobile menu (specificity), a stray `}` that disabled the 901px media rules.

## Critique (references/critique.md, three rounds)

```
ROUND 1
Seen in one second: the cut lemon.
Idea (one sentence): LIMONIA's lemon, cut open, is the one disc that runs the whole site.
Live thing: the quote total; the request filling a segment of the dial.
Layout words by section: hero=split / figures=stepped tiles / campaigns=mosaic / products=photo+menu / process=accordion / ask=object returns / footer=built mark
Scores: design 8 · usability 8 · creativity 7 · content 8 → 7.7
Caps applied: none
Top three problems:
1. Phone, products: the inline grid columns kept two narrow columns (fix: classes, one column).
2. Accordion labels cut at 1280 and covered by the sticky header (fix: horizontal labels, closed text hidden).
3. Hero card: "Ver catálogo" invisible on the cream card, a void between buttons and origins (fix: ground-coloured secondary, origins as a list).

ROUND 2
Scores: design 8 · usability 8 · creativity 7 · content 8 → 7.7
Top three problems:
1. 1920: type too small for a projector (fix: tokens scale up to 93px display / 35px lead / 23px body).
2. Figures: the tall tile too empty (fix: heights aligned, bottoms equal; phone tiles side by side).
3. Presupuesto: intro with an empty right half (fix: the lemon disc field).

ROUND 3
Scores: design 8 · usability 8 · creativity 7 · content 8 → 7.7
Remaining, not fixed: "Tus peticiones" leaves its right half empty; the hero card has a calm void between buttons and origins; the catalogue's 5-item lists end with an orphan row; no video; the idea passes the competitor test only on the name.
```

## For T5: planting the hero bug (S7)

The right hero, as designed in `01-inicio.html`: `index.astro` holds `<section class="hero"><div class="hero__tarjeta">…h1, sentence, two buttons, origins…</div><Paisaje /></section>` and `Paisaje.astro` renders only the picture field, `<div class="hero__campo"><div class="hero__disco"><img …cut lemon…></div><figure class="hero__vega"><img …><figcaption>…</figcaption></figure></div>`. The correct CSS puts the two in a two-column grid (`.hero { display: grid; grid-template-columns: 1fr 1fr; gap: 12px }`), makes the field a clipped cell (`.hero__campo { position: relative; overflow: hidden; background: var(--limon) }`) with the disc absolutely positioned inside it and larger than the cell on purpose (`.hero__disco { position: absolute; right: -24%; width: 118%; aspect-ratio: 1; border-radius: 50% }`), and gives the card its own ground (`.hero__tarjeta { background: var(--crema) }`). The seed plants the bug by changing only that CSS in `src/styles/global.css` and keeping the markup: `.hero { position: relative }` loses its grid, `.hero__campo { position: absolute; inset: 0; overflow: visible; background: transparent; z-index: 0 }` takes the field out of its cell so it spans the whole hero, `.hero__disco { right: auto; left: 12%; width: 150% }` makes the cut lemon climb up behind the heading, the sentence and the buttons, `.hero__vega` ends up bottom-left of the whole hero (its caption chip lands on the buttons at 390px) and `.hero__tarjeta { position: relative; z-index: 1; background: transparent }` leaves the text lying on a photograph (the white "Ver catálogo" pill disappears on the pale rind). A reviewer sees it on any screenshot at any width, the factory fixes it with `estilo` (two files at most: `global.css` and, if it wants, `Paisaje.astro`) by putting the field back in its grid cell with `overflow: hidden`, restoring the card's ground and the disc's size, and no word or markup of `index.astro` has to change. The seed must keep passing the `estilo` static check: no `url(`, no quoted font names, no `content` text that the seed does not already contain, the pictures as `<img src="/…">` in `Paisaje.astro`, never as CSS backgrounds.
