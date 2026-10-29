# LIMONIA editorial: the site and the factory board, inspired by diagram-design

The whole site and, above all, the /factory/ board are redesigned with the grammar of
https://github.com/cathrynlavery/diagram-design (MIT), keeping the LIMONIA brand. The board becomes a real flow diagram.

## Specs

- **S1** Problem, verbatim: "puff se ve mal, va dando saltos y es 0 interactivo, necesitamos mejorar mucho el diseño en general, el flujo va a saltos y en general la ui de toda la página es fea, porque no te inspiras en esto https://github.com/cathrynlavery/diagram-design tanto para la web como la parte de factory que es la importante".
- **S2** Skin: "LIMONIA editorial": keep the brand (oliva, limón, tierra, warm paper) with the diagram-design grammar: flat, no shadows, hairline borders, dot-grid paper, monospace for details, uppercase tracked labels, one accent for what matters, legend.
- **S3** Board interaction (selected): "Peticiones que viajan" (each request is a token that slides along the diagram's arrows from one station to the next, smooth, no jumps; the gate sends it along the AUTO or PERSONA edge); "Tocar una petición" (tap it or search its number: its path lights up and a panel shows its title, the state of each station, the motivo if refused and its PR link); "Tocar una estación" (tap a station: what it does and which requests are in it).
- **S4** No jumps: the board never repaints as a whole; requests keep their place and move with transitions; `prefers-reduced-motion` gets the same states without travel.
- **S5** Works on a phone and on the projector (earlier: "se tienen que poder ver también en movil").
- **S6** The factory is the priority ("la parte de factory que es la importante"); the rest of the site follows.
- **S8** Decisions on the prototype ("esta bien, sube el cambio"): below ~1500 px the board uses the vertical diagram; /api/estado says when a request went back to Build so its token travels the dashed loop.
- **S7** The planted hero bug stays broken in the new look (it is the demo's visual bug for the factory to fix).

## Tasks

| ID | Specs | Route | Commit |
|----|-------|-------|--------|
| T1 ✅ | S2 | worker: design/system.md + system.html become "LIMONIA editorial" | dade0d1 |
| T2 ✅ | S2-S6 | worker: interactive board artboard(s), responsive, in design/factory-diagrama/ | dade0d1 |
| T3 ✅ | S3-S6, S8 | worker: implement the board on /factory/ | |
| T4 | S2, S6, S7 | worker: site artboards (home, catálogo, presupuesto, tarea) | |
| T5 | S2, S7 | worker: implement the site, seed hero updated keeping the bug | |

## Log

- **L1** User: S1 verbatim. Decisions: skin "LIMONIA editorial (Recomendado)"; interaction "Peticiones que viajan, Tocar una petición, Tocar una estación" (not "Modo presentación").
- **L2** Reference read by the parent: diagram-design `skills/diagram-design/references/style-guide.md` (semantic roles paper/ink/muted/soft/rule/accent, contrast contract, one focal accent), `animation.md` (static-first, one clock 160/480/720 ms, CSS owns presentation, no jumps, reduced motion), screenshots flowchart/swimlane/architecture (hairline nodes, labelled SVG edges, diamond decisions, dot grid, mono sublabels, legend).
- **L3** T1 + T2 designed (no code, not committed): `design/system.md` + `design/system.html` rewritten as LIMONIA editorial (role mapping, computed contrast table, flat grammar, motion clock; `src/styles/global.css` unchanged until T5). Board prototype in `design/factory-diagrama/` (`01-diagrama.html`, `design.json`): SVG flowchart, keyed tokens that travel along the edges (WAAPI, 480 ms per station), tap a request / tap a station panel, vertical layout on a phone. Chosen artboard for T3: `01-diagrama.html`.
- **L4** Board prototype fixed after review: the panel, token, node marks and counters derive from one task object (`autoComprobacion()` in `01-diagrama.html` checks all 61 sim steps, 0 failures); `retry` now puts Builder en curso and clears Approver; the last reviewer hands over to Approver in the same step; #43 retitled "Una lista con las claves del servidor" (tipo feature); the desktop layout is taller and scales to fill 1920×1080 with no page scroll.
- **L5** User: "esta bien, sube el cambio" (prototype approved; the parent's two proposals accepted: vertical under ~1500 px, a "vuelta a Build" field in /api/estado). The design ships together with the board so design/system.md never describes a site that is not there yet.
- **L6** T3 done (not committed). Data: `vueltas` (1-2, absent = 0) in the task state, set by `applyEvent` on the approver `retry` (which now also puts Builder `en_curso`, the reviewers and the approver `pendiente`, phase `build`), dropped by `parseState` unless an integer 1-2, returned by `derivar` as 0-2 (a state without it derives 0). Board: `/factory/` is the prototype as a page: server-rendered SVG in two layouts (`src/components/DiagramaFactory.astro`, geometry in `src/lib/geometria.js`), keyed tokens moved with WAAPI (480 ms per station, loop via `vueltas`), panels, bottom sheet on phones, `?demo=1&paso=N` kept, Pausa/Reiniciar removed; pure logic in `src/lib/tablero.js`. The new CSS (`.fd*`) avoids quoted strings that the seed `global.css` lacks (font names unquoted, no `grid-template-areas`) so the `estilo` static check keeps passing; the seed in `factory/seed/` is not updated (T5). Evidence: RED→GREEN for `vueltas`/retry (`test/state.test.mjs`, `test/estado.test.mjs`) and for the pure logic (`test/tablero.test.mjs`, 21 tests incl. every step of the demo); built HTML in `test/web.test.mjs`; screenshots in `/tmp/fd3/` (1920×1080, 1440×900, 390 wide): no horizontal scroll from 360 px, no page scroll at 1500×900 and 1920×1080. Also fixed `test/estilo.test.mjs` (two prompts asserted the old design-system title, broken by T1).
