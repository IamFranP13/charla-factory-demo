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
| T0 | S1 | inline: design system synced, ux/ui read `design/system.md`, `design/**` human (earlier in this session) | |
| T1 | S1 | inline: usability, contrast and layout rules in `design/system.md` | |
| T2 | S2 | inline: hero files in `factory/seed/`, so `reset-demo` restores the broken hero | |
| T3 | S3-S5 | inline: kind `estilo` (CSS + visual components), static check in code, gate routes, replay fix | |
| T4 | S3, S6 | inline: render the candidate site and give screenshots to the ux and ui reviewers; factory workflow | |
| T5 | S1-S6 | inline: docs (README, AGENTS), full suite, simulated run of the example request | |

## Log

- **L1** User: "quiero dejar el hero que se vea mal a proposito y que en la factory al tener subagentes de ui/ux si alguien pide el arreglo se haga, lo primero sería dejar en el proyecto como tienen que ser temás de diseño, usabilidad contraste y demás y que luego la factory sea capaz de arreglarlo solo"
- **L2** Decisions: surface "CSS + componentes visuales"; gate "Auto si pasa los checks"; visual check "Solo capturas a modelo".
- **L3** Platform invariant (AGENTS.md, "Code is never trusted"): an `.astro` file is code (its frontmatter runs at build time, a `<script>` or `set:html` reaches the visitor). The `estilo` surface is guarded in code: frontmatter and template expressions unchanged, no `<script>`, `set:html`, event handlers, imports or URLs; CSS without `@import` or external `url()`. The site is rendered for screenshots only after that check passes, with an empty environment.
- **L4** Evidence: GitHub's `ubuntu-latest` ships Google Chrome; headless Chrome takes screenshots (`--screenshot`), so no new dependency. The factory job installs with `npm ci --omit=dev` (no Astro): rendering needs the dev dependencies there.
- **L5** Reference of the expected fix: `design/hero-inicio/01-franja-inferior.html` (artboards made earlier; the user chose to keep the hero broken instead of fixing it by hand).
