# Factory board: explain the steps

The live board (/factory/) explains itself: what each station does, what is happening to the request you follow, and a
first-time guided tour for people arriving from the QR. Delivery: straight to main (maintainer change), tests first.

## Specs

- **S1** Request, verbatim: "el tablero está bien aunque tendríamos que informar mejor de los pasos aunque los iremos modificando" → "vamos a explicar mejor lo del tablero".
- **S2** "Qué hace cada estación": each station box says in one line what it does and who does it (a model, code, or a person), without tapping it.
- **S3** "Qué le pasa a MI petición": for the followed request, plain-language text of the step it is in and what is happening now (e.g. "Cuatro revisores miran tu cambio a la vez…"), and its final result with the motivo when refused. Only data /api/estado already returns (estaciones, ruta, pr, resultadoFinal, motivo, vueltas); no per-station reasons (not stored).
- **S4** "Una guía para el público": a "recorrido" mode that the first time shows the chain step by step ("1 de 8: Entrada…"), skippable, reopenable, for people arriving from the QR without context.
- **S5** The texts live in one place so they can be changed later ("aunque los iremos modificando").
- **S6** Same design system, phone and projector, accessibility (keyboard, focus, screen readers, reduced motion).

## Tasks

| ID | Specs | Route | Commit |
|----|-------|-------|--------|
| T1 | S1-S6 | ✅ done · worker: texts module, station lines, follow narrative, guided tour, tests, screenshots | d518a98 |

## Log

- **L1** User: S1 verbatim; selected "Qué hace cada estación", "Qué le pasa a MI petición", "Una guía para el público" (not "Por qué va a una persona o no").
- **L2** T1 done (worker, not committed). `src/lib/explica.js` holds every text (stations: quien, linea, largo, en_curso, hecho, rechazada; the gate and Main/PR by `ruta`; `RECORRIDO` 8 steps; `narrativa(t)` from API fields only). Diagram: each box shows a MODELO/CÓDIGO/PERSONA pill and its line (2 rows max, wrapped by `envuelve`), both layouts; geometry resized (horizontal NH 128, P 152, gate 224×216, entrada 140; vertical boxes 108 high, gate 176) so the board still fits 1920×1080 without page scroll. Panel leads with the narrative + timeline; live region = `lineaViva`. Tour: button `¿Cómo funciona?`, `?recorrido=N`, auto-open only < 1500 px, first visit, not demo, not `?n=`. Tests first: `test/explica.test.mjs` failed on import (no `envuelve`, `CARACTERES_POR_PX`, `LINEAS_NODO`) before the geometry/texts existed, then 12/12 green; plus `lineaViva` test in `test/tablero.test.mjs` and two web tests in `test/web.test.mjs` (boxes with pill + line in both layouts; button and 8-step tour markup). Screenshots in `/tmp/fte/`: wide-p10, wide-n2, wide-n3, wide-rec1, wide-rec5 (1920×1080), phone-tour, phone-n2, phone-rec5 (390). Suite with `FACTORY_BROWSER` chromium: 476 tests, 474 pass, 1 skipped, 1 fail: `the estilo surface of the seed … carry the same (broken) hero`, because `factory/seed/src/styles/global.css` must be a copy of `src/styles/global.css` (outside this task's edit surface; the parent copies it).
