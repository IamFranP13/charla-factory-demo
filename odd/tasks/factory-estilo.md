# Factory: design system and the `estilo` kind

The hero of the home page stays broken on purpose (a planted bug); the design rules live in the project and the factory,
with its ux/ui reviewers looking at screenshots, can fix it by itself when someone asks.
Branch: `feat/factory-estilo`. Earlier work in this branch: `design/system.md` read by the ux/ui reviewers, `design/**` human.

## Specs

- **S1** Design rules in the project: "lo primero sería dejar en el proyecto como tienen que ser temás de diseño, usabilidad contraste y demás". They live in `design/system.md` (synced with gentle-design) and are the reference of the ux and ui reviewers.
- **S2** Planted bug: "quiero dejar el hero que se vea mal a proposito". The hero as it is today (landscape over the text and the buttons) is the starting state, and `reset-demo` restores it like the other planted bugs.
- **S3** The factory fixes it: "que en la factory al tener subagentes de ui/ux si alguien pide el arreglo se haga" and "que luego la factory sea capaz de arreglarlo solo". Example request: "el botón del hero no se ve bien".
- **S4** Surface of the new kind: "CSS + componentes visuales".
- **S5** Gate: "Auto si pasa los checks".
- **S6** How the factory checks the visual result: "Solo capturas a modelo" (the reviewers see screenshots; no measured visual checks in code).

## Tasks

| ID | Specs | Route | Commit |
|----|-------|-------|--------|
| T0 ✅ | S1 | inline: design system synced, ux/ui read `design/system.md`, `design/**` human (earlier in this session) | 94b51de |
| T1 ✅ | S1 | inline: usability, contrast and layout rules in `design/system.md` | 1cdffc0 |
| T2 ✅ | S2 | inline: hero files in `factory/seed/`, so `reset-demo` restores the broken hero | 1cdffc0 |
| T3 ✅ | S3-S5 | worker: kind `estilo` (CSS + visual components), static check in code, gate routes, replay fix | 6040853 |
| T4 ✅ | S3, S6 | worker: render the candidate site and give screenshots to the ux and ui reviewers; factory workflow | dd832da |
| T5 ✅ | S1-S6 | inline: docs (README, AGENTS), full suite, simulated run of the example request | |

## Log

- **L1** User: "quiero dejar el hero que se vea mal a proposito y que en la factory al tener subagentes de ui/ux si alguien pide el arreglo se haga, lo primero sería dejar en el proyecto como tienen que ser temás de diseño, usabilidad contraste y demás y que luego la factory sea capaz de arreglarlo solo"
- **L2** Decisions: surface "CSS + componentes visuales"; gate "Auto si pasa los checks"; visual check "Solo capturas a modelo".
- **L3** Platform invariant (AGENTS.md, "Code is never trusted"): an `.astro` file is code (its frontmatter runs at build time, a `<script>` or `set:html` reaches the visitor). The `estilo` surface is guarded in code: frontmatter and template expressions unchanged, no `<script>`, `set:html`, event handlers, imports or URLs; CSS without `@import` or external `url()`. The site is rendered for screenshots only after that check passes, with an empty environment.
- **L4** Evidence: GitHub's `ubuntu-latest` ships Google Chrome; headless Chrome takes screenshots (`--screenshot`), so no new dependency. The factory job installs with `npm ci --omit=dev` (no Astro): rendering needs the dev dependencies there.
- **L6** Evidence (T1): the planted bug is measurable: "Ver catálogo" (`--oliva-oscuro`) over the `--oliva` hill is 1.70:1. The overline (`--tierra`) is 4.34 on `--blanco`: recorded as a known deviation, not fixed.
- **L5** Reference of the expected fix: `design/hero-inicio/01-franja-inferior.html` (artboards made earlier; the user chose to keep the hero broken instead of fixing it by hand).
- **L7** Evidence (T3): independent verify could not run bypass probes (stopped by its safety classifier); the parent probed `checkEstilo` and confirmed two bypasses: (1) an expression could move into another context (`<p style={campana.texto}>`: audience campaign text, which auto-merges and whose schema accepts `javascript:alert(1)` and `background:red`, would become CSS); (2) an estilo change could add text (`content: "Envío gratis…"` in CSS, a new `<p>` in the footer) guarded only by models. Fixed in `lib/estilo.js` (expressions keep their context; no new CSS strings; same words in components), with RED→GREEN tests. Suite 409 pass, 0 fail, 1 skipped.
- **L8** Evidence (T4): `lib/render.js` builds the candidate site in a scratch copy (empty env: PATH, HOME/TMPDIR in the scratch dir), serves it on 127.0.0.1 and takes 6 headless shots (home before/after desktop and mobile, catalogue and quote after); ux/ui get them as a multimodal message, a site that does not build goes back to the Builder, a render failure fails closed (allowed only with replay). Local Brave ignores `--screenshot`; Playwright's Chromium works (`FACTORY_BROWSER=~/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`): suite 426 pass, 0 fail, 1 skipped (pre-existing). The parent looked at the real shots: the first replay fix (band height + sun moved) left the hill cut flat and the sun half hidden; replaced by a CSS-only fix (`.paisaje` `height: auto; aspect-ratio: 10 / 3`, `.hero` bottom padding `max(9rem, 17vw)`): text and buttons clear, sun whole, hills complete at 1280 and 390. Not verified: Google Chrome on GitHub's ubuntu-latest (may need `--no-sandbox`; fails closed if so), and a real vision model.
- **L9** Evidence (T5): end to end in a scratch copy, `node scripts/factory.mjs --profile marketing --request "el botón del hero no se ve bien"` (replay, Playwright's Chromium): spec ok (estilo) → build ok `src/styles/global.css · 6 capturas` → seguridad, ux, ui, codigo ok → approver 4/4 → Result ok; `gate.mjs` routes `src/styles/global.css` auto; `reset-demo` (dry run) restores `src/styles/global.css`. Docs (README, AGENTS) updated in T3/T4. Not done: an `estilo` entry in `test/battery.json` (simulate.test pins ids 46 and 47).
