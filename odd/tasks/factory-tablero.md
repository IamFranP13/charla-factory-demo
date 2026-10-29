# Factory board: the "sala de control" design on /factory/

The live board (/factory/) becomes the responsive "sala de control" chosen by the user: cards on a phone, a table with a
side panel on the projector. Same data (/api/estado, and the demo mode `?demo=1`). Branch: `feat/factory-tablero`.

## Specs

- **S1** The design: `design/factory-tablero/04-sala-de-control-adaptable.html` ("si implementalo", after "en movil se ve genial, ahora en web se mal"). Layout by width: < 720 px cards with the 11-segment bar and the current station named, "Sigue tu petición #" at the top; 720–1199 px cards in two columns, gate and queue side by side; 1200–1599 px the table with counters and "Sigue tu petición" above, gate and queue below; ≥ 1600 px the table with the side panel; content capped and centred on wide screens.
- **S2** Real data only: every task, counter, queue entry and motivo comes from /api/estado (`tareas`, `cola`, `contadores`) or the demo mode; the followed request (`?n=` or the "Sigue tu petición" form) is marked "Tú" and goes first on narrow screens.
- **S3** Rejected requests stay visible with their motivo for 30 s (was 6 s) before leaving for the counter (proposal accepted with "si implementalo").
- **S4** Design system and accessibility as in `design/system.md`: tokens only, AA contrast, state never by colour alone (✓ ● ! –), each cell named for screen readers, `prefers-reduced-motion`.

## Tasks

| ID | Specs | Route | Commit |
|----|-------|-------|--------|
| T1 | S1-S4 | worker: implement the board in `src/pages/factory.astro` (+ its client script and styles), keep `/tarea/` working, tests, screenshots of the real page in demo mode | done (not committed) |

## Log

- **L1** User: "perfecto, pues lo siguiente es empezar a diseñar la factory de verdad" → "La pantalla /factory/". Then "lo tengo abierto, pero el diseño piensa que se tienen que poder ver también en movil", "en movil se ve genial, ahora en web se mal", "si implementalo".
- **L2** Design artboards: `design/factory-tablero/` (01-03 desktop, 01-03 mobile, 04 responsive). Chosen: `04-sala-de-control-adaptable.html`; the others are alternatives.
- **L3** T1 done (S1-S4). `src/pages/factory.astro` = server-rendered shell (title, legend, counters, "Sigue tu petición #" form, 11 station headers in 3 groups, gate, queue) + client script that polls `/api/estado` every 5 s (`sondeo.js`) or the demo (`?demo=1&paso=N`) and draws one row per task with 11 cells (textContent only). Pure mapping in `src/lib/tablero.js` (cells, rechazo label, retention: rejections 30 s, deployed/sin_cambios 4 s, followed request never leaves). Board CSS moved to `src/styles/global.css` under `.sala` (grid placement by line, not `grid-template-areas`: the `estilo` static check flags any new quoted string in the stylesheet); old board styles, `tablero` prop of `Diagrama.astro` and `crearFichas` removed (`/tarea/` keeps `.ruta/.paso/.revisor`). Tests: RED first (`test/tablero.test.mjs` fails with no module; the two new `/factory/` tests in `test/web.test.mjs` fail against the old page), then GREEN; `npm test` 440 tests, 439 pass, 0 fail, 1 skipped. Screenshots seen in `/tmp/ftb/`: `p7-1920`, `p12-1920`, `p7-1440`, `p7n2-1440` (followed #2, "Tú", highlighted), `p5-1440`, `p7-1024` (cards in two columns, gate and queue side by side), `p7-390` and `p7n1-390` (cards, followed #1 first), `tarea-demo` (`/tarea/?demo=1&n=2` still renders the stepper). They match artboard 04.
- **L4** Parent check of the screenshots: on a phone, a request the gate routed to a person but not yet in the queue showed its bar at ● and its label at "– ¿Humano? pendiente". Fixed in `src/lib/tablero.js` (a human route not yet approved or refused is en curso), test RED→GREEN; suite 440 pass, 0 fail, 1 skipped; screenshot at 390 checked.
