# LIMONIA editorial design system

Synced by people (gentle-design "design system sync"); only humans change it. The factory's `ux` and `ui` reviewers judge every change against it. Brand and tone live in `brain/marca.md`; this file is the visual and component side. Sources: `src/styles/global.css` (the brand tokens), `src/components/` (components), `lib/schemas.js` and `src/features/contrato.js` (limits).

**LIMONIA editorial** keeps the LIMONIA brand (oliva, limón, tierra, warm paper) and takes its grammar from [diagram-design](https://github.com/cathrynlavery/diagram-design) by Cathryn Lavery (MIT licence): flat, hairline borders, dot-grid paper, monospace for details, uppercase tracked labels, one accent for what matters, a legend, one motion clock. The colours, the serif and the sans are the brand's; the grammar is borrowed. Nothing is copied from its files.

> **Migration status.** The factory board (`/factory/`, `.fd` in `src/styles/global.css`) already follows it; the rest of the site is being migrated (`odd/tasks/diseno-editorial.md`) and still has the previous look. These values change there: `--radio` 18px → 8px for cards and 6px for controls, `--sombra` removed (no shadows; a 1px `--borde` hairline instead), buttons and badges stop being pills (radius 6px; only chips stay pills), the overline (`.sobretitulo`) moves from `--tierra` to `--tinta-suave`, and a monospace stack is added. No brand colour changes.

## Colors

Brand colours are unchanged. Each one is mapped to a semantic role (diagram-design's roles); components say the role, the role resolves to a brand token.

| Role | Brand token | Value | Usage |
|------|-------------|-------|-------|
| `paper` | `--blanco` | `#fbf8f1` | Page background (warm white) |
| `paper-2` | `--crema` | `#f3ecdc` | Quiet surfaces: table headers, chips, panel headers |
| `surface` | (literal) | `#fff` | Node, card and panel fill (lifts without a shadow) |
| `ink` | `--tinta` | `#2a301a` | Body text, primary strokes |
| `muted` | `--tinta-suave` | `#5c6245` | Secondary text, default connector stroke, node borders |
| `soft` | `--tinta-suave` | `#5c6245` | Sublabels, legend text, overlines (same value as `muted`: the brand has no lighter text colour that passes) |
| `rule` | `--borde` | `#e2d9c3` | Hairlines, separators, table rows (decorative, never the only carrier of meaning) |
| `rule-solid` | `--oliva-claro` | `#a7b36a` | Stronger separators, the border of a finished step (a mark, never text) |
| `accent` | `--oliva` | `#5b6b2e` | The ONE focal colour: buttons, the active path, the followed request, links on hover |
| `accent-ink` | `--oliva-oscuro` | `#3b4720` | Headings, footer background, accent text that needs more contrast, hover of `accent` |
| `accent-tint` | `--oliva` at 10% | `rgb(91 107 46 / 10%)` | Fill of an accent-bordered node (≈ `#efefea` on `#fff`) |
| `highlight` | `--limon` | `#f2d643` | Highlight fill only (a step in progress, a new thing): always with `ink` text, never as text or as a thin line |
| `highlight-soft` | `--limon-suave` | `#fbf0b0` | "Waiting for a person", soft notices |
| `earth` | `--tierra` | `#9a6b46` | Campaign `tierra`, decorative marks and large text only |
| `earth-soft` | `--tierra-suave` | `#ead9c4` | "Not available" badge |
| `link` | `--oliva-oscuro` | `#3b4720` | Links, always underlined (the brand has no blue) |
| (literal) | | `#e3ecc2` / `#33401a` | "OK" badge background / text |
| (literal) | | `#5c3a1f` | "Not available" badge text |
| (literal) | | `#fbe6dc` / `#7a2b0e` / `#c4511f` | Errors and refusals only: background / text / border |

Campaign colours stay exactly `oliva`, `limon`, `tierra`, `blanco` (`lib/schemas.js`). The error reds are for the platform's own error states (a refused request, a form error), never a campaign or feature colour. The brand has no pink, red, blue, purple or black campaign colour (`brain/marca.md`).

**One accent.** `accent` (`--oliva`) is the only focal colour of a screen or a diagram: the thing the reader is meant to look at (the followed request and its path, the primary button). Two accents erase the signal. `highlight` (`--limon`) is not an accent: it is a fill that says "happening now" and always carries `ink` text.

## Typography

| Role | Value | Usage |
|------|-------|-------|
| `title`, `numbers` | `--fuente-titulo`: `ui-serif, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif` | `h1`-`h3`, brand, big figures |
| `node-name`, body | `--fuente`: `'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif` | Body 1.0625rem / 1.6; node names (600) |
| `mono` | `--mono`: `ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace` | Sublabels, request numbers (`#43`), counters, edge labels, code. System stack only: no web font |
| `eyebrow` | `--mono`, `.72rem`, weight 500, uppercase, `.14em` tracking, `soft` | Section and lane labels, overlines, legend heading |
| `edge-label` | `--mono`, `.7rem`, uppercase, `.06em` tracking, `soft` (`accent-ink` on the active path) | Labels on connectors (`AUTO`, `PERSONA`) |

Scale (site): `h1` `clamp(2.2rem, 5vw, 3.6rem)`; `h2` `clamp(1.5rem, 3vw, 2.1rem)`; `h3` `1.25rem`; lead `1.15rem`. Headings line-height 1.15, colour `--oliva-oscuro`. Mono is for technical content (numbers, ids, states, kinds); names stay in the sans; the serif is for headings and big figures. Never italic serif except an editorial aside. Three families, not more.

## Grammar

- **Flat.** No `box-shadow` anywhere. Lift comes from a `surface` (`#fff`) fill on `paper`, never from a shadow. A focus ring is an outline, not a shadow.
- **Hairlines.** Borders are 1px (`rule` for separators and cards; `muted` for the border of a node or control that carries meaning). Emphasis is 1.5px at most, in `accent`.
- **Radius.** Nodes, cards, panels and controls: 6px (nodes and controls) or 8px (containers, panels). Pills (`999px`) only for chips, request tokens and badges.
- **Dot-grid paper** for diagram areas: a 22px grid of 1px dots in `ink` at 10% on `paper`. Never behind running text, forms or cards of text; only behind a diagram.
- **Uppercase tracked labels** in mono for lanes, sections and edges; sentence case everywhere else (the text itself is never typed in capitals).
- **Connectors** are SVG: orthogonal, quarter-arc corners (r 8), an arrowhead, 1.2px `muted`; the active path is `accent` 2px; a return or optional path is dashed `5 4`. Every decision exit is labelled (mono, uppercase). Draw connectors before nodes.
- **Shape carries type**: rounded rectangle = step; oval/pill = start or end; diamond = decision (at most 3 exits); filled dot = merge. Fill never signals type.
- **Legend at the foot**, after a hairline, never inside the diagram.
- **Grid**: structural sizes (nodes, gaps, padding) are multiples of 4px.
- **Components** (button, badge, campaign card, product card, feature) keep the rules below, with the new radius and no shadow.

## Spacing and radius

| Token | Value | Usage |
|-------|-------|-------|
| `.contenedor` | `min(1120px, 100% - 2.5rem)` | Page width |
| `.seccion` | `clamp(2.5rem, 6vw, 4.5rem)` block padding | Section rhythm |
| grid gap | `1.25rem` | Card grids |
| card padding | `1.25rem` | Cards, forms, panels |
| `--radio` | `8px` (target; `18px` until migrated) | Cards, panels |
| control radius | `6px` | Buttons, inputs, nodes |
| pill | `999px` | Chips, request tokens, badges only |
| shadow | none | (the former `--sombra` is retired) |

## Motion

Motion explains; it never carries meaning alone. One clock for everything: `--motion-fast: 160ms` (hover, focus, fades), `--motion-step: 480ms` (a request moving one station, a panel opening), `--motion-hold: 720ms` (a pause that lets the eye catch up). Easing `cubic-bezier(.2, .8, .2, 1)`; no springs, bounce, glow, particles or indefinite blinking. Animate `transform` and `opacity` only, never layout. Elements are stable and keyed: they move, they are not re-created. `prefers-reduced-motion: reduce` shows the same states with no travel (durations ≈ 0).

## Components

- **Button** (`.boton`): 6px radius, `--oliva` background, white text, weight 600; variants `--borde` (outline, `muted` hairline) and `--suave` (translucent white, inside campaign cards). One primary per block.
- **Badge** (`.insignia`): pill, `#e3ecc2`/`#33401a` or `--tierra-suave`/`#5c3a1f`. Product availability only.
- **Chip / request token**: pill, mono `#n`, 1px `muted` border, `surface` fill. A followed token is `accent` fill with white text; a refused one `#fbe6dc`/`#7a2b0e`/`#c4511f`; the one in progress `--limon` with `ink`. Always a number or a mark besides the colour.
- **Node** (diagram step): `surface` fill, 1px `muted` border, 6px radius, name (sans 600) and a mono sublabel. Focal node: `accent-tint` fill, 1.5px `accent` border. Decision: diamond.
- **Campaign card** (`src/components/CampanaCard.astro`): optional emoji, `h3` title, text, optional `cta` that always links to `/presupuesto/`. `color` is exactly one of `oliva`, `limon`, `tierra`, `blanco`. Limits: `titulo` 60, `texto` 160, `emoji` 8, `cta` 30 characters.
- **Product card** (`src/components/ProductoCard.astro`): emoji, availability badge, name, price per kg or "Precio a consultar". `descripcion` up to 160 characters.
- **Feature** (`src/components/Features.astro`, `src/features/contrato.js`): a section with an `h2` title (up to 60 characters) and ONE generic body: `lista` (up to 40 items `{ texto ≤ 200, valor? ≤ 60 }`), `tabla` (1 to 6 columns ≤ 40, up to 40 rows, cells ≤ 100) or `texto`. Plain text only: no HTML, colours, classes or links. It shows on `inicio`, `catalogo` or `presupuesto`.
- **Panel / sheet**: `surface`, 1px `rule`, 8px radius, a `paper-2` header with an eyebrow; a bottom sheet on a phone.

## Rules

- Use only these tokens; a change never introduces a new colour, font or component.
- Text is plain and sentence case: no shouting in capitals (eyebrows and edge labels are styled by CSS, not written in capitals).
- Motion respects `prefers-reduced-motion`; focus is always visible (`3px solid --oliva`, offset 2px).
- State is never colour alone: a word or a mark (✓ ● ! –) always goes with it.

## Contrast (WCAG 2.2 AA)

Every text and control is judged against what is really behind it on screen (an illustration, a gradient, a hill, a tint), not against the page background. Translucent fills are composited over their surface before measuring.

- Body text and small text: at least **4.5:1**. Large text (24px, or 18.66px bold) and essential non-text marks (connector strokes, borders of controls, arrowheads, focus rings): at least **3:1**. `rule`, `paper-2` and tints are decorative.
- Computed ratios (WCAG 2.x relative luminance, computed for this change):

| Foreground | Surface | Ratio | Use |
|------------|---------|-------|-----|
| `ink` `#2a301a` | `paper` | 12.89 | Body text |
| `ink` | `paper-2` | 11.62 | Text on chips, headers |
| `ink` | `surface` `#fff` | 13.67 | Text in nodes and panels |
| `muted` / `soft` `#5c6245` | `paper` | 6.02 | Secondary text, sublabels |
| `muted` / `soft` | `paper-2` | 5.43 | Eyebrows on headers |
| `muted` / `soft` | `surface` | 6.39 | Sublabels in nodes, connector strokes |
| `muted` / `soft` | `highlight-soft` | 5.53 | Notes in a "waiting" notice |
| `muted` | `accent-tint` | 5.28 | Text in a focal node |
| `accent` `#5b6b2e` | `paper` | 5.52 | Accent text, active path |
| `accent` | `paper-2` | 4.97 | Accent on chips |
| `accent` | `surface` | 5.85 | Accent text in nodes |
| `accent` | `accent-tint` | 4.84 | Accent text inside a focal node |
| `accent-ink` / `link` `#3b4720` | `paper` | 9.39 | Headings, links |
| `accent-ink` | `highlight-soft` | 8.63 | Heading on the hero |
| `accent-ink` | `highlight` | 6.87 | Text on a lemon fill (prefer `ink`) |
| white | `accent` | 5.85 | Button, followed token |
| white | `accent-ink` | 9.96 | Footer |
| `ink` | `highlight` `#f2d643` | 9.42 | Step in progress |
| `ink` | `highlight-soft` | 11.84 | Waiting notice |
| `ink` | `earth-soft` | 9.91 | Not-available badge |
| `#7a2b0e` | `#fbe6dc` | 8.01 | Refusal text |
| `#c4511f` | `paper` / `surface` | 4.36 / 4.62 | Refusal border and mark (≥ 3 as a mark) |
| `#33401a` | `#e3ecc2` | 9.02 | OK badge |
| `earth` `#9a6b46` | `paper` / `surface` / `paper-2` | 4.34 / 4.60 / 3.91 | **Not for small text.** Large text, marks, decoration; white on `earth` 4.60 |
| `rule-solid` `#a7b36a` | `paper` / `surface` | 2.13 / 2.26 | Mark only, always next to a ✓ and a word |
| `highlight` `#f2d643` | `paper` | 1.37 | Fill only, never a line or text |
| `rule` `#e2d9c3` | `paper` | 1.32 | Decorative hairline only |

- Pairs that fail, never use them for text or a control: `--oliva-oscuro` on `--oliva` 1.70 · `--tinta-suave` on `--oliva-claro` 2.83 · `--oliva-oscuro` on `--oliva-claro` 4.41 (large text only) · `--tierra` as small text on `paper-2` 3.91 · `--limon` as text anywhere.
- Text never sits on an illustration or a photo without a solid surface (`#fff`, `--blanco` or `--crema`) between them.

## Layout

- **Text and controls never overlap an illustration.** In the hero, the landscape (`src/components/Paisaje.astro`) is decoration: it lives in a band below the text and the buttons, at every width; the sun and the trees are shown whole, not cut by the edges.
- Nothing overflows sideways: no horizontal scroll from 360px to 1440px wide (a diagram on a phone goes vertical instead of shrinking).
- Readable lines: at most about 75 characters (`.lead` 60ch, `.hero__texto` 38rem).
- Touch targets at least **44 × 44 px** (buttons, menu links, form controls, request tokens on a phone); at least `.8rem` between two of them.
- One primary button (`.boton`) per block; the secondary action is `.boton--borde`. On a phone, buttons wrap and stay full size.
- The order on screen is the reading order: the page reads top to bottom without the illustration.
- A diagram has its legend at the foot, hairline above it; on a projector at 1920px, type in a diagram is at least 12px mono for sublabels and 18px for station names, request tokens at least 12px mono bold; on a phone it is never scaled below 0.95.

## Usability

- Every page shows what it is for in its first screen: title, one sentence, the main action.
- Links and buttons say where they go ("Calcular presupuesto", "Ver catálogo"), never "click here".
- State is never shown by colour alone: a badge, a step or a token also has a word or a mark (✓ ● ! –).
- Errors say what happened and how to fix it, next to the field they belong to.
- Everything clickable in a diagram (a station, a request) is a real button with an accessible name and a visible focus, and Esc closes what it opened.

## How the ux and ui reviewers use this file

- `ui` judges the look: tokens, contrast, layout, the grammar and the component rules above, on the screenshots when there are any.
- `ux` judges the experience: the copy, the reading order, the usability rules, whether the change does what was asked.
- A change is judged by what it changes. A deviation that was already there and that the change does not touch is not a reason to refuse it.

## Known deviations

- **The home hero breaks the layout and contrast rules** (`src/components/Paisaje.astro`, `.hero` and `.paisaje` in `src/styles/global.css`): the landscape fills the whole hero, so the hills climb behind the text and the buttons ("Ver catálogo", `--oliva-oscuro` on `--oliva`, 1.70), and the sun and the trees are cut. It is a planted bug of the demo, left on purpose for the factory to fix; `npm run reset-demo` puts it back. It stays broken in the editorial look until the factory fixes it.
- The site still has the previous look (pill buttons, 18px radius, `--sombra`) until `src/styles/global.css` is migrated; the old look is not a deviation to refuse a change for.
- The overline (`.sobretitulo`, `--tierra`, .8rem bold) is 4.34 on `--blanco` and 3.98 on `--limon-suave`, under 4.5. The editorial overline is `soft` mono (6.02), which fixes it once migrated.
