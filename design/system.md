# LIMONIA design system

Synced from the site's sources by people (gentle-design "design system sync"); only humans change it. The factory's `ux` and `ui` reviewers judge every change against it. Brand and tone live in `brain/marca.md`; this file is the visual and component side. Sources: `src/styles/global.css` (tokens and base styles), `src/components/` (components), `lib/schemas.js` and `src/features/contrato.js` (limits).

## Colors

| Token | Value | Usage | Source |
|-------|-------|-------|--------|
| `--oliva` | `#5b6b2e` | Main colour: buttons, links, active menu, figures, campaign `oliva` | `src/styles/global.css` |
| `--oliva-oscuro` | `#3b4720` | Headings, hover of buttons and links, footer background | `src/styles/global.css` |
| `--oliva-claro` | `#a7b36a` | Border of a finished step | `src/styles/global.css` |
| `--limon` | `#f2d643` | Accent for offers and news, campaign `limon`, step in progress | `src/styles/global.css` |
| `--limon-suave` | `#fbf0b0` | Hero gradient, "soon" badge, waiting for a person | `src/styles/global.css` |
| `--blanco` | `#fbf8f1` | Page background (warm white) | `src/styles/global.css` |
| `--crema` | `#f3ecdc` | Quiet surfaces: quote summary, table headers, chips | `src/styles/global.css` |
| `--tierra` | `#9a6b46` | Overlines, product meta, campaign `tierra` | `src/styles/global.css` |
| `--tierra-suave` | `#ead9c4` | "Not available" badge | `src/styles/global.css` |
| `--tinta` | `#2a301a` | Body text | `src/styles/global.css` |
| `--tinta-suave` | `#5c6245` | Secondary text, notes | `src/styles/global.css` |
| `--borde` | `#e2d9c3` | Borders of cards, inputs and tables | `src/styles/global.css` |
| (literal) | `#fff` | Card background; text on `oliva` and `tierra` | `src/styles/global.css` |
| (literal) | `#e3ecc2` / `#33401a` | "OK" badge background / text | `src/styles/global.css` |
| (literal) | `#5c3a1f` | "Not available" badge text | `src/styles/global.css` |
| (literal) | `#fbe6dc` / `#7a2b0e` / `#c4511f` | Errors and refusals only: background / text / border | `src/styles/global.css` |

The error reds are for the platform's own error states, never a campaign or feature colour. The brand has no pink, red, blue, purple or black campaign colour (`brain/marca.md`).

## Typography

| Token | Value | Usage | Source |
|-------|-------|-------|--------|
| `--fuente` | `'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif` | Body, 1.0625rem, line-height 1.6 | `src/styles/global.css` |
| `--fuente-titulo` | `ui-serif, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif` | `h1`-`h3`, figures, totals, brand | `src/styles/global.css` |

Scale: `h1` `clamp(2.2rem, 5vw, 3.6rem)`; `h2` `clamp(1.5rem, 3vw, 2.1rem)`; `h3` `1.25rem`; lead `1.15rem`; overline `.8rem` uppercase, `.14em` tracking, weight 700, `--tierra`; badge `.78rem` weight 700. Headings line-height 1.15, colour `--oliva-oscuro`.

## Spacing, radius and shadow

| Token | Value | Usage | Source |
|-------|-------|-------|--------|
| `.contenedor` | `min(1120px, 100% - 2.5rem)` | Page width | `src/styles/global.css` |
| `.seccion` | `clamp(2.5rem, 6vw, 4.5rem)` block padding | Section rhythm | `src/styles/global.css` |
| grid gap | `1.25rem` (`.rejilla`) | Card grids | `src/styles/global.css` |
| card padding | `1.4rem` (`.tarjeta`), `1.5rem` (forms, summary) | Cards | `src/styles/global.css` |
| `--radio` | `18px` | Cards, panels | `src/styles/global.css` |
| inputs radius | `12px` | Inputs, small panels | `src/styles/global.css` |
| pill | `999px` | Buttons, badges, chips, menu | `src/styles/global.css` |
| `--sombra` | `0 1px 2px rgb(42 48 26 / 6%), 0 8px 24px rgb(42 48 26 / 8%)` | Cards, panels, button hover | `src/styles/global.css` |

## Components

- **Button** (`.boton`): pill, `--oliva` background, white text, weight 600; variants `--borde` (outline) and `--suave` (translucent white, used inside campaign cards). Source: `src/styles/global.css`.
- **Badge** (`.insignia`): pill, `--ok` (green) or `--no` (`--tierra-suave`). Product availability only. Source: `src/components/ProductoCard.astro`.
- **Campaign card** (`src/components/CampanaCard.astro`): optional emoji, `h3` title, text, optional `cta` button that always links to `/presupuesto/`. `color` is exactly one of `oliva`, `limon`, `tierra`, `blanco` (`lib/schemas.js`). Limits: `titulo` 60, `texto` 160, `emoji` 8, `cta` 30 characters.
- **Product card** (`src/components/ProductoCard.astro`): emoji, availability badge, name, price per kg or "Precio a consultar". `descripcion` up to 160 characters.
- **Feature** (`src/components/Features.astro`, `src/features/contrato.js`): a section with an `h2` title (up to 60 characters) and ONE generic body, painted by the site, never by the feature: `lista` (up to 40 items `{ texto ≤ 200, valor? ≤ 60 }`), `tabla` (1 to 6 columns ≤ 40, up to 40 rows, cells ≤ 100) or `texto`. Plain text only: no HTML, colours, classes or links. It shows on `inicio`, `catalogo` or `presupuesto`.

## Rules

- Use only these tokens; a change never introduces a new colour, font or component.
- Text is plain and sentence case: no shouting in capitals (overlines are styled by CSS, not written in capitals).
- Motion respects `prefers-reduced-motion`; focus is always visible (`3px solid --oliva`).
