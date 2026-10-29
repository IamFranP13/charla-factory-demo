# LIMONIA editorial design system

Synced by people (gentle-design "design system sync"); only humans change it. The factory's `ux` and `ui` reviewers judge every change against it. Brand and tone live in `brain/marca.md`; this file is the visual and component side. Sources: `src/styles/global.css` (the tokens), `src/components/` (components), `lib/schemas.js` and `src/features/contrato.js` (limits). Artboards of every page: `design/web-limonia/` (`01-inicio`, `02-catalogo`, `03-presupuesto`, `04-tarea`); the live specimen of this file is `design/system.html`.

**LIMONIA editorial** has two layers that share one set of brand colours:

- **The site** (home, catalogue, quote calculator, request tracking, header, footer) follows the method of [taste-skill](https://github.com/leonxlnx/taste-skill) by leonxlnx (MIT licence), direction **one motif**. The idea: **LIMONIA's own lemon, cut open, becomes one disc that runs the whole site**: the big disc of the home hero, the one quarter-circle corner of every card and photograph, the pill of every button, the disc bullet of every list, the progress dial of a request, the block-built mark of the footer. Flat fields of colour, real photographs of the huerta, big type, no ornament.
- **The factory board** (`/factory/`, `.fd` in `src/styles/global.css`) keeps its [diagram-design](https://github.com/cathrynlavery/diagram-design) grammar (hairlines, dot-grid paper, monospace labels, SVG connectors): it is the product's own interface, the way taste-skill treats a real interface fragment. The board changes only through its own task; this file's site rules (no hairlines, no monospace) do not apply inside `.fd`.

What the site and the board share: the brand colours and their roles, the header and the footer, Figtree as the text face, the motion clock, the focus ring, the rule "state is never colour alone", the accent used once. What is only the board's: monospace, uppercase tracked labels, hairlines, dot-grid, `--sombra`-free connectors.

> **Migration status.** The board already follows its grammar in `src/styles/global.css`; the rest of the site still has the previous look (serif headings, pill menu, shadows, `--radio` 18px) until the implementation task (`odd/tasks/diseno-editorial.md`, T5) lands the artboards. Tokens the board still reads and that must stay defined: `--mono`, `--ease`, `--motion-fast`, `--motion-step`, `--radio` (now 8px), `--acento-tinte`, `--sombra` (now `none`), `--fuente`, `--borde`.

## Colors

Brand colours are unchanged. Each one has a role; components say the role, the role resolves to a brand token.

| Role | Brand token | Value | Usage |
|------|-------------|-------|-------|
| `ground` | `--blanco` | `#fbf8f1` | Page background (warm white, the brand's "blanco cálido") |
| `step` | `--crema` | `#f3ecdc` | A tone step: the hero card, the campaigns band, secondary buttons, small chips. Surfaces are separated by a tone step, never by a line or a shadow |
| `surface` | (literal) | `#fff` | Input fill, the white calculator sheet, the `blanco` campaign card |
| `ink` | `--tinta` | `#2a301a` | All running text and headings. Full ink, never soft grey for body copy |
| `soft` | `--tinta-suave` | `#5c6245` | Placeholders and the hover of a field only (6.02 on `ground`). Notes are set in `ink` at the small size |
| `accent` | `--oliva` | `#5b6b2e` | The primary button, the "here" mark (the current station), link hover. One accent per screen |
| `deep` | `--oliva-oscuro` | `#3b4720` | The dark band (process, footer), links, focus ring, letters knocked out of the footer mark |
| `fresh` | `--oliva-claro` | `#a7b36a` | A field of the process strip and the footer mark, the green bullet of vegetables; with `ink` text only |
| `lemon` | `--limon` | `#f2d643` | The motif: the hero field, the figures tile, the disc bullet, the total of a quote, the "now" mark. Always a fill with `ink` text; never text, never a line |
| `lemon-soft` | `--limon-suave` | `#fbf0b0` | Pending segments of the dial, "waiting for a person" |
| `earth` | `--tierra` | `#9a6b46` | The `tierra` campaign and one figures tile; white text only (4.60) |
| `earth-soft` | `--tierra-suave` | `#ead9c4` | "Not available" badge, hover of secondary buttons, a footer-mark block |
| `control` | (literal) | `#7d835f` | The border of a form field (3.97 on `surface`, ≥ 3 as a control boundary) |
| `rule` | `--borde` | `#e2d9c3` | The frame of the calculator sheet and the rows of a real table only. Decorative |
| (literal) | | `#e3ecc2` / `#33401a` | "Available" badge background / text |
| (literal) | | `#5c3a1f` | "Not available" badge text |
| (literal) | | `#fbe6dc` / `#7a2b0e` | Errors and refusals only: background / text |

**Campaign colours stay exactly `oliva`, `limon`, `tierra`, `blanco`** (`lib/schemas.js`). A campaign card is one flat field of that colour with the text colour of the table below; the error colours are for the platform's own error states, never a campaign or feature colour. The brand has no pink, red, blue, purple or black campaign colour (`brain/marca.md`).

| Campaign `color` | Field | Text | Button inside |
|------------------|-------|------|---------------|
| `oliva` | `--oliva` | white | white fill, `ink` text |
| `limon` | `--limon` | `ink` | `--oliva` fill, white text |
| `tierra` | `--tierra` | white | white fill, `ink` text |
| `blanco` | `#fff` (on the `step` band) | `ink` | `--oliva` fill, white text |

**One accent.** Per screen, `accent` is the single "look here" colour (the primary button, the current station). `lemon` is the motif, a field, not a second accent: it never carries meaning on its own and always sits with `ink`.

## Typography

Two faces, both **SIL OFL**, served from the site itself (`assets/fonts/` in the artboards; never from another server): **League Spartan** 700 for display and figures, **Figtree** (variable 300–900) for everything else. Only the latin subset is shipped (it covers Spanish). `@font-face` lives in a stylesheet outside the `estilo` surface (`src/styles/fuentes.css`, a platform file), because `url(` is forbidden in `global.css`; `global.css` only names the families, **unquoted** (`League Spartan`, `Figtree`).

| Step | Token | Value | Usage |
|------|-------|-------|-------|
| `display` | `--t-display` | `clamp(2.75rem, 1rem + 4vw, 6.5rem)` | `h1` and the big figures. League Spartan 700, tracking -.035em, leading .95, sentence case |
| `title` | `--t-titulo` | `clamp(2.1rem, 1rem + 3.1vw, 5.25rem)` | `h2`, big card titles |
| `lead` | `--t-lead` | `clamp(1.25rem, 1rem + 1vw, 2.25rem)` | `h3`, prices, supporting sentences of a section, the totals. League Spartan for headings and prices, Figtree for sentences |
| `body` | `--t-cuerpo` | `clamp(1.0625rem, .95rem + .4vw, 1.5rem)` | Running text, buttons, nav links, form labels. Leading 1.55, at most 62 characters per line |
| `small` | `--t-peq` | `clamp(.875rem, .8rem + .2vw, 1.125rem)` | Captions, badges, counters. Never below 14px |

Five steps per page, no more (the inspector measures 16 / 21 / 30 / 61 / 74 px plus the footer mark at 1440). Headlines are two lines or fewer at every width; a statement is a paragraph of at most three lines. Left-aligned by default. No monospace, no uppercase tracked labels, no italic, no eyebrows, no index numbers (01, 02), no accent word inside a headline: order is carried by position, size and the words. A real `<ol>` is fine when order is data (the stations of a request).

## The motif and the grammar

- **The disc.** The cut lemon is a circle. It appears at three or four very different scales and nowhere else as a shape: the hero field's giant half-lemon (a real photograph of a cut lemon masked to a circle, cropped by the field's edge, turning once every 160 s), the small `punto`/`bola` bullet (28px, `lemon` for fruit, `fresh` for vegetables), the pill button, the disc that returns at the bottom of the request band, and the dial of a request. A second shape (hexagon, blob) never appears.
- **One corner.** Every card, tile, field, photograph and panel is square except its **top-right corner, which is a quarter circle** (`--cuarto: clamp(44px, 6vw, 104px)`; half of it for small items). One radius rule, decided once.
- **Flat.** No `box-shadow` anywhere (the former `--sombra` is retired), no gradient (a rind is a flat circle), no glass, no blur. Lift comes from a tone step (`ground` → `step` → `surface`). The focus ring is an outline.
- **No hairlines.** Nothing is separated by a 1px line: space, a tone step, a change of scale or a filled shape does it. The only lines left are the border of real form fields (`--control`), the frame of the calculator sheet and the rows of the discount table (real table, `rule`).
- **The stripe.** The only ornament: a 40px band of alternating `deep` and `lemon` bars, 28px each, across the top of the hero card (a crate label). Bars are filled blocks, never lines or gradients. It appears once, in the hero.
- **The mark.** The footer builds `LIMONIA` from seven solid blocks of different heights (60–100%, 4px gaps, bottoms on one line), each letter knocked out in `deep`. The header mark is a 32px `lemon` disc with an `accent` leaf.
- **The frame.** One pair of equal outer margins (`--margen`: 20px on a phone to 32px on a projector) and one 12-column grid with a 12px gutter (`--hueco`). Large things run to the margins; a column of text is answered by a picture, a list or a figure on the far side, never by an empty half. Sections are 160–240px apart on desktop (80–120px of padding each).
- **Fullness.** Each desktop screen is a poster: one dominant thing (the disc, a photograph, a figure) and the content it carries.

## Imagery

- **Real photographs of the huerta's world**, found in open archives, downloaded into the project at 300 KB or less (webp), credited in the footer (name of the picture, author, licence) and in `design/web-limonia/assets/CREDITS.md` with the source URL. Only Public Domain / CC0 / CC BY / CC BY-SA. A found photograph shows the place and the fruit, never "our" warehouse, team or lorries.
- The set of the artboards (reusable at different crops): `vega-del-segura`, `limon-cortado` (the motif), `limonero`, `naranjos`, `huerta-de-murcia`, `puerto-de-cartagena`. One family of light and one treatment: natural, ungraded, cropped square-cornered with the top-right quarter circle.
- Photographs are `<img>` elements with a real `alt`, `width` and `height`, `loading="lazy"` below the first screen; the hero images are not lazy. A caption says what the picture is and sits on a solid chip (`ground` fill, `ink` text) inside the picture's corner or under it; text never lies on a photograph.
- **Static check of `estilo`:** CSS may not contain `url(`, an image function, `@import`, `://` or a backslash; an `.astro` component may not contain `<image>`, `<use>`, `<link>`, `<script>`, `data:`, `//` or an external URL, and its `src` may only be a path of this site (`/imagenes/…`). So pictures are always `<img src="/…">`, never CSS backgrounds, and drawings are inline SVG shapes without `<use>`.
- Nothing is ever loaded from another server: no CDN, no remote font, no hotlinked picture.
- The emoji fields of the content (`emoji` of a campaign or a product) are **not painted** by this design: an emoji is a font glyph of the visitor's platform and breaks the single graphic language. The data keeps the field; the disc bullet replaces it. (Restoring it is a one-line change in `CampanaCard.astro` and `ProductoCard.astro`.)

## Spacing and radius

| Token | Value | Usage |
|-------|-------|-------|
| `--margen` | `clamp(20px, 2.2vw, 32px)` | Both outer margins, everywhere |
| `--hueco` | `12px` | Grid gutter and the gap between tiles and cards |
| `--cuarto` | `clamp(44px, 6vw, 104px)` | The top-right quarter circle (half for small items) |
| section | `clamp(80px, 8vw, 120px)` block padding | Rhythm: neighbouring sections never share a layout |
| control | `0` (fields), pill `999px` (buttons, chips, badges) | One button shape: the pill |
| fragment radius | `16px` sheet, `12px` panels, `10px` fields | Only inside `[data-ui]` (the calculator), see Components |
| shadow | none | `--sombra: none` |

## Motion

Motion explains; it never carries meaning alone. One clock for everything: `--motion-fast: 160ms` (hover, press, focus), `--motion-step: 480ms` (an accordion panel opening, a dial segment changing), `--motion-hold: 720ms`. Easing `--ease: cubic-bezier(.2, .8, .2, 1)`; no springs, bounce, glow, particles or indefinite blinking. Animate `transform`, `opacity` (and the flex size of the accordion) only.

- Each part of a section enters in order (heading, text, picture) rising 28px with opacity, 80ms apart, once, as it enters the screen; content is visible if the script fails (it is revealed after 3 s regardless).
- Feedback on every control: buttons lift 2px on hover and press to .97; links and list rows slide 4px.
- One slow move: the cut lemon of the hero turns once per 160 s.
- `prefers-reduced-motion: reduce` keeps every state and drops the travel (durations ≈ 0, no rotation).

## Components

- **Header** (`src/components/Header.astro`): a plain bar on `ground`, 72px: the mark and wordmark (League Spartan 700), four links (`Inicio`, `Catálogo`, `Presupuesto`, `Factory`; the current one underlined 4px in `lemon`, bold) and one action (`Pedir un cambio`, primary pill). Below 900px it becomes `Menú` (a 44px pill) opening a full-width `step` sheet with the links at title size. The board sits under this same header.
- **Footer** (`src/components/Footer.astro`): `deep` field, the block-built `LIMONIA` mark, four links, the sentence "Empresa ficticia para una demo. Los precios y las tarifas son simulados.", the photograph credits (one short line each) and one `lemon` pill. It closes the board page too.
- **Button** (`.boton`, `.btn` in the artboards): a pill, 48px tall, 28px side padding, body size 600, no border. Primary `accent` fill with white text (hover `deep`); secondary `step` fill with `ink` text; on a `step` card the secondary is `ground`; on the dark band the action is `lemon` with `ink`. One primary per block. Disabled stays legible (`earth-soft` fill, `#5c3a1f` text) and says why.
- **Badge** (`.insignia`): pill, `small`, `#e3ecc2`/`#33401a` or `earth-soft`/`#5c3a1f`. Product availability only; always a word ("Disponible", "No disponible").
- **Campaign card** (`src/components/CampanaCard.astro`): one flat field of its colour (table above), top-right quarter circle, `h3` at title size (League Spartan), text at body size (at most 34 characters per line), optional `cta` as a pill that always links to `/presupuesto/`. Cards sit on the `step` band as a 12-column mosaic: pairs spanning 7/5 and 5/7, a lone last card as a full-width band. `color` is exactly one of `oliva`, `limon`, `tierra`, `blanco`. Limits: `titulo` 60, `texto` 160, `emoji` 8 (not painted), `cta` 30 characters.
- **Product row** (`src/components/ProductoCard.astro`): a menu list, not a card grid: a 28px disc bullet (`lemon` fruit, `fresh` vegetable), the name (`h3`) and the price on the same line (price in League Spartan with the unit small, or "Precio a consultar" in Figtree 600), the description in `ink`, then the availability badge and the origin. No boxes; two columns on desktop, one on a phone, 36–44px between rows. `descripcion` up to 160 characters.
- **Figures tile**: the stepped tiles of the home (a tall `lemon` one, a `deep` one and an `earth` one with unequal tops and aligned bottoms): the figure at display size top-left, the caption at lead size bottom-left, each with its quarter-circle corner. Real figures only (counts computed from the catalogue).
- **Feature** (`src/components/Features.astro`, `src/features/contrato.js`): a section with an `h2` title (up to 60 characters) and ONE generic body: `lista` (up to 40 items `{ texto ≤ 200, valor? ≤ 60 }`, painted as disc-bullet rows with the value right-aligned in League Spartan), `tabla` (1 to 6 columns ≤ 40, up to 40 rows, cells ≤ 100: a real table, header in `ink` 600, 1px `rule` between rows) or `texto` (a paragraph at body size). Plain text only: no HTML, colours, classes or links. It shows on `inicio`, `catalogo` or `presupuesto`.
- **Process strip** (accordion, home): five stations as panels dark to light (`deep`, `accent`, `fresh`, `#cdd69b`, `#e3ecc2`), the open one 9× wider with its name at title size and a 36-character sentence, the others slivers with the name at lead size; a button each (`aria-expanded`), one open at a time, vertical bars below 1000px.
- **Request form** (`#peticion`, `src/components/PeticionForm.astro`): on a `ground` panel with the quarter-circle corner over the `lemon` band (the disc returns at its foot). Label above the field at body size, textarea with a 1px `--control` border and square corners, a visible counter `n / 150` linked with `aria-describedby`, the primary pill, a `role="status"` line below. "Tus peticiones" is a plain list with a `lemon` disc bullet and the number in League Spartan.
- **Calculator** (`src/components/Calculadora.astro`, root `data-ui`): follows the app-screen rules of taste-skill inside its own frame: a `step` frame holding a white sheet (16px radius, 1px `rule`, no shadow); on the left the lines (label above each field at small size, 48px controls with a `--control` border and 10px radius, "Quitar" as a text button in `#7a2b0e`), "Añadir producto" as a secondary pill, the destination field; on the right a sticky summary panel (`ground`, 12px radius) with the lines, subtotal, discount, transport and a `lemon` total at 40px in League Spartan. Errors are `#fbe6dc`/`#7a2b0e` rows with a "!" mark and a sentence, next to the fields. Numbers are tabular and right-aligned.
- **Request progress** (`/tarea/`, `src/components/Diagrama.astro` replaced): the cut lemon as a dial of seven segments (Entrada, Spec writer, Builder, Revisión, Approver, Puerta, Producción): done = `accent` with a check, current = white with a dot, stopped = `#7a2b0e` with a cross, pending = `lemon-soft` with its number; the hub says "4 de 7". Beside it the same stations as a list (marker disc, name, one sentence, a state word: Hecho / En curso / Se detuvo aquí / Pendiente), the four reviewers of Revisión as chips with a mark and a word, and the final message in a field with the quarter-circle corner (`lemon-soft`, `accent` with white text when it is live, `#fbe6dc`/`#7a2b0e` when refused). Marks are inline SVG, never glyphs.
- **Board** (`.fd`): unchanged, see the first section.

## Rules

- Use only these tokens; a change never introduces a new colour, font or component. A visual change keeps the single corner, the pill, the disc and the flat fields.
- Text is plain and sentence case: no shouting in capitals, no accent word, no emoji.
- Motion respects `prefers-reduced-motion`; focus is always visible (`3px solid --oliva-oscuro`, offset 3px).
- State is never colour alone: a word or a mark (check, dot, cross, "!") always goes with it.
- In `global.css` write font names unquoted, never `url(`, `@import`, `://` or a backslash (the `estilo` check).

## Contrast (WCAG 2.2 AA)

Every text and control is judged against what is really behind it on screen (a photograph, a field, a tint), not against the page background. Text never lies on a photograph: it sits on a solid surface (`ground`, `step`, a campaign field).

- Body text and small text: at least **4.5:1**. Large text (24px, or 18.66px bold) and essential non-text marks (the border of a control, the focus ring, a state mark): at least **3:1**. `rule`, `step` and tints are decorative.
- Computed ratios (WCAG 2.x relative luminance):

| Foreground | Surface | Ratio | Use |
|------------|---------|-------|-----|
| `ink` `#2a301a` | `ground` `#fbf8f1` | 12.89 | Body text |
| `ink` | `step` `#f3ecdc` | 11.62 | Hero card, secondary button |
| `ink` | `surface` `#fff` | 13.67 | Fields, calculator, `blanco` campaign |
| `ink` | `lemon` `#f2d643` | 9.42 | Hero field figures, `limon` campaign, total, `lemon` button |
| `ink` | `lemon-soft` `#fbf0b0` | 11.84 | Final message "en la factory", pending dial segment |
| `ink` | `earth-soft` `#ead9c4` | 9.91 | Hover of a secondary button |
| `ink` | `#e3ecc2` | 11.09 | Last strip panel |
| `ink` | `fresh` `#a7b36a` | 6.05 | Third strip panel, `fresh` footer block |
| `ink` | `#cdd69b` | 8.91 | Fourth strip panel |
| `soft` `#5c6245` | `ground` / `surface` | 6.02 / 6.39 | Placeholder (never body text) |
| `accent` `#5b6b2e` | `ground` | 5.52 | Link hover, list-row hover |
| white | `accent` | 5.85 | Primary button, `oliva` campaign body text, done mark |
| white | `deep` `#3b4720` | 9.96 | Process band, footer |
| white | `earth` `#9a6b46` | 4.60 | `tierra` campaign (body text), figures tile |
| `deep` | `ground` | 9.39 | Links, wordmark |
| `deep` | `lemon` | 6.87 | Footer link hover (`lemon` on `deep`) |
| `deep` | `fresh` | 4.41 | Footer mark letters (huge text, ≥ 3) |
| `deep` | `lemon-soft` / `earth-soft` / `step` | 8.63 / 7.22 / 8.46 | Footer mark letters |
| `#33401a` | `#e3ecc2` | 9.02 | "Disponible" badge |
| `#5c3a1f` | `earth-soft` | 7.32 | "No disponible" badge, disabled button |
| `#7a2b0e` | `#fbe6dc` | 8.01 | Errors, refusals |
| `#7a2b0e` | `surface` | 9.64 | "Quitar" text button |
| white | `#7a2b0e` | 9.64 | Stopped dial segment, refusal mark |
| `--control` `#7d835f` | `surface` / `ground` | 3.97 / 3.75 | Border of a form field (≥ 3 as a boundary) |
| `deep` (focus ring) | `ground` / `lemon` | 9.39 / 6.87 | Focus outline |
| `earth` | `ground` | 4.34 | **Not for text.** Fields only (white text on it passes) |
| `fresh` | `ground` | 2.13 | Mark only (a bullet), never text |
| `lemon` | `ground` | 1.37 | Fill only, never a line or text |
| `rule` `#e2d9c3` | `ground` | 1.32 | Decorative frame and table rows only |

- Pairs that fail, never use them for text or a control: `deep` on `accent` 1.70 · `soft` on `fresh` 2.83 · `ink` on `accent` 2.34 · `lemon` as text anywhere · `earth` as small text on `ground` 4.34 or on `step` 3.91.

## Layout

- **The hero is a split of two fields and nothing overlaps the text.** Left, the `step` card (stripe, `h1`, one supporting sentence, the two buttons, the three origins); right, the `lemon` field holding the cut lemon and one small photograph with its caption chip. The giant disc is cropped by the field's own edge (`overflow: hidden` on the field), so it can never climb under the card. At every width the text and the buttons are on `step`; on a phone the card comes first and the field follows below it.
- Text and controls never overlap an illustration or a photograph; captions sit on a solid chip.
- Nothing overflows sideways: no horizontal scroll from 360px to 1920px (the board goes vertical on a phone).
- Readable lines: at most about 62 characters (`max-width` in `ch`).
- Touch targets at least **44 × 44 px** (buttons, menu links, form controls, "Quitar"); at least 8px between two of them.
- One primary button per block; the secondary action is the `step` pill. On a phone buttons wrap and stay full size.
- The order on screen is the reading order: the page reads top to bottom without the pictures.
- **Projector (1920 × 1080).** Type scales with the width up to the caps of the tokens (body ≈ 23px, lead ≈ 35px, display ≈ 93px), the hero fills one screen, tiles scale (`vw` heights), and the board keeps its own sizes (station names at least 18px, request tokens at least 12px).
- **Phone (390px).** Its own composition: hero card then the field; figures tiles with the two small ones side by side, the right one 32px lower; menu list in one column; the process strip as vertical bars; the calculator as a column with the summary below; the dial above the station list.

## Usability

- Every page shows what it is for in its first screen: title, one sentence, the main action.
- Links and buttons say where they go ("Calcular presupuesto", "Ver catálogo"), never "click here".
- State is never shown by colour alone: a badge, a station or a token also has a word or a mark.
- Errors say what happened and how to fix it, next to the field they belong to (`role="alert"`).
- Every control works from the keyboard in reading order and has an accessible name; the accordion buttons announce `aria-expanded`; Esc closes the mobile menu.
- Everything clickable in the board (a station, a request) is a real button with an accessible name and a visible focus.

## How the ux and ui reviewers use this file

- `ui` judges the look: tokens, contrast, layout, the grammar and the component rules above, on the screenshots when there are any.
- `ux` judges the experience: the copy, the reading order, the usability rules, whether the change does what was asked.
- A change is judged by what it changes. A deviation that was already there and that the change does not touch is not a reason to refuse it.

## Known deviations

- **The home hero is broken on purpose** (the demo's planted visual bug, S7): in the seed, the hero field loses its `overflow: hidden` and its place in the grid and the giant disc and the Vega photograph are laid behind the whole hero, so the cut lemon climbs behind the heading, the supporting sentence and the buttons ("Ver catálogo" is a white pill over a pale rind) and the caption chip lands on the buttons at narrow widths. It lives in `.hero`, `.hero__campo`, `.hero__disco`, `.hero__vega` of `src/styles/global.css` and in the hero illustration component (`src/components/Paisaje.astro`), and is fixable in CSS alone: the field back in its grid cell with `overflow: hidden`, the card on its own `step` ground above it. `npm run reset-demo` puts it back. The factory is meant to fix it live; until then the rules under "Layout" are violated there.
- The site still has the previous look until `src/styles/global.css` is migrated; the old look is not a deviation to refuse a change for.
- `[data-ui]` fragments (the calculator) keep their own app conventions (1px frame, 10–16px radii, 40px figures); the rest of the site does not.
- The board keeps monospace, hairlines and the dot grid (its own grammar); the site never uses them.
- The `oliva` campaign puts 19–21px white text on `#5b6b2e` (5.85): it passes AA, not the 7:1 the inspector prefers. The brand colour is not changed for it.
- The paper `#fbf8f1` and the band `#f3ecdc` are the brand's warm whites; the inspector flags them as "yellow cream" (a palette warning for cream with terracotta). The site uses `tierra` on one tile and one campaign only.
