# charla-factory-demo

A tiny AI factory, built for the talk *Vibe Engineering a escala de empresa*.

The audience scans a QR code and asks for a change to this website. The change is built by agents (being rebuilt, see below). A **risk gate written in code, not in a prompt** decides whether the change goes straight to production or waits for a human.

The whole platform is a couple of thousand lines of plain JavaScript and a handful of workflows. That is the point of the talk: **an AI factory is not an AI problem, it is a platform problem.**

## Status: the factory is being rebuilt

The old factory (a chain of model stations run by a GitHub Actions workflow, with a replay model) has been removed. It is being replaced by **Claude Code agents with tools**, run by a local orchestrator on the maintainer's PC (`odd/tasks/fabrica-agentes.md`). The factory is **off** until you run `npm run fabrica` (see below): the form keeps accepting requests, the issues wait in the queue (label `entrada`), and the risk gate, CI, rebuild, deploy and the board work on any pull request. For now the orchestrator stops after the agent's commit (no push, no pull request: task T5).

## How it works

```
QR → form (src/pages/) → Pages Function (functions/api/peticion.js) → GitHub issue labelled "entrada"
                                                                        ↓
              (being rebuilt) an agent works the task and opens a pull request; until then the issue waits.
              The task state kept in the issue body is what the board shows
                                                                        ↓
              gate.yml: scripts/gate.mjs reads policy/risk.yaml and the PR's changed files
                    ↓                                               ↓
            low risk → auto-merge                      high risk → blocked until an approver approves
                    ↓
            Cloudflare Pages deploys main (produccion)
```

| Piece | Where | What it shows |
|-------|-------|---------------|
| Profiles | `lib/intake.js` | Who asked: Marketing, Producto or Negocio, drawn at random by the server. Only a label (`perfil:*`): it does not limit what a request can be. |
| Kinds | `factory/kinds.yaml` | What a request IS: `campana` (`content/campanas/`), `producto` and `destino` (`catalogo/`), `precios`, `descuentos`, `transporte` (`data/precios.json`, `data/descuentos.json`, `config/transporte.json`), `estilo` (the look of the site: `src/styles/global.css` and five presentational components, see *The look of the site*) and the three code kinds `bug`, `feature`, `cambio` (`src/features/`, `src/domain/`). The kinds define the surfaces and the static checks that stay (`lib/sandbox.js`, `lib/estilo.js`). |
| Brain and design | `brain/`, `design/` | Brand, tone and decisions (`brain/`) and the design system (`design/system.md`), both human-only. The agents will read them. |
| Task state | `<!-- factory:state {...} -->` in the issue body | One station map per task (`pendiente`, `en_curso`, `ok`, `rechazada`, `error`) for the board. Written only by scripts (`scripts/gate.mjs`, `scripts/rebuild.mjs` and the future orchestrator), rendered from known fields (model text can never reach it). `puerta` and `merge` are set by the gate. Optional `tipo` (the kind, one of `factory/kinds.yaml`), `vueltas` (integer 1-2: how many times the approver sent the task back to `build`; absent means none), `motivo` (plain text, at most 160 characters: why a station refused or failed) and `mergeCommit` (the PR's merge commit, 40 hex) and `reconstruida` (`true` once the task was rebuilt after a conflict with `main`; never removed). `produccion` is confirmed by `/api/estado`, not stored (see *Following a request*). The pure helpers live in `lib/estado.js`. |
| Follow-up | `functions/api/estado.js`, `lib/estado.js`, `/tarea/?n=N`, `/factory/` | `GET /api/estado` is the one read the pages poll every 5 s: the task of each request, the queue waiting for a person and the counters. See *Following a request*. |
| Risk gate | `policy/risk.yaml`, `lib/policy.js`, `scripts/gate.mjs` | Decides by **what the diff touches**, never by who asked. Safe changes merge by themselves (campaigns, catalogue, a feature if CI passes, the look of the site if its static check passes); risky ones wait for a human (prices, discounts, the domain, the platform). Fails closed. Approvals count only on the current head. A pull request an approver opens from this repository (people preparing the platform) is already the human decision: it passes the gate, which never merges it by itself. A factory pull request an approver approves is merged by the gate, pinned to the approved head. |
| Rebuild | `.github/workflows/rebuild.yml`, `scripts/rebuild.mjs`, `lib/rebuild.js` | After every push to `main` each open factory pull request (branch `tarea/<n>` of this repository, task state pointing at it) that GitHub reports as conflicting (`mergeable: false`; `null` is asked again up to 6 times, then left) is closed, its branch deleted and its task run again on the current `main` (its state says pending again, with `reconstruida` kept, so the orchestrator picks it up in its queue; nothing is relabelled). **At most once**: the state gets `reconstruida: true` first (it survives the factory restarting the state, `replaceState`); a second conflict closes the pull request and the task with a comment. A step that fails after the flag is written is reported and never retried (at most once wins; a branch or label already gone counts as done). Closing the old PR never writes the state of a task that already points at its new PR (`gate.mjs --closed`). One queue (`concurrency: rebuild`); only the App token writes (contents, pull-requests, issues). |
| Code | `lib/sandbox.js`, `src/features/`, `src/domain/`, `scripts/build-features.mjs` | Small code written by the factory, with its isolation. See *Code from the audience*. |
| Intake | `lib/intake.js` | Requests of at most 150 characters; the server draws the profile at random, in equal parts. Turnstile, a task cap and a kill switch. Input is data, never instructions. |
| Shared rules | `AGENTS.md` | The same rules for the factory agents and for a local harness (Pi, Claude Code, OpenCode…). |

## Code from the audience

Any request can be small code: **`bug`** (a fix in a feature or in the domain), **`feature`** (a new section of a page) or **`cambio`** (a business rule). The kind does not depend on the profile.

- **Surface** (checked by code, `lib/sandbox.js` `codePathError`): `src/features/<id>/index.js` + `index.test.mjs` (a new feature goes in `src/features/tarea-<n>/`, named by the orchestrator; or an existing one, for a bug) and `src/domain/*.js` + `*.test.mjs` (existing files, or new ones named `tarea-<n>...`). `feature` only touches features, `cambio` only the domain, `bug` either. At most 3 files; the model answers either the whole text of a file or exact edits (`cambios: [{buscar, reemplazar}]`, each `buscar` must match once) that the factory applies.
- **Contract of a feature** (`src/features/contrato.js`): `export default { id, titulo (≤ 60), donde: 'inicio'|'catalogo'|'presupuesto', calcular(estado) }`. `calcular` is pure and returns data: `{tipo: 'lista', items}`, `{tipo: 'tabla', columnas, filas}` or `{tipo: 'texto', texto}` (plain text, ≤ 40 rows). One generic component (`components/Features.astro`) paints it with escaped text.
- **The registry** is generated at build time (`scripts/build-features.mjs`, runs in `npm run build` and `npm run dev`; `src/features/index.js` is not committed). Every feature is computed **inside the isolation** and the site only receives the data it returned: it never imports the code of a feature. A feature that does not load, breaks the contract, throws or hangs is skipped with a warning; the build never fails because of it.
- **Isolation guarantee.** Nothing a model writes is imported by the factory, the gate or the site's build. `src/domain/` and `src/features/` are code a model can change (a `bug` or `cambio` into `src/domain/`, a human route), and the processes that run with secrets in reach (the factory job with the model key, the gate with a write token, the Cloudflare build with the Turnstile secret and the issues token) must never load it. So **platform code (`lib/`, `scripts/`, `functions/`) never imports `src/domain/` or `src/features/`**: validating the catalogue (`validateCatalog`), quoting the sample orders (`presupuestar`), the `codigo` station and the feature registry all run the domain inside the isolation and only read JSON back (`checkState`, `runSuite`, `evaluateFeatures` in `lib/sandbox.js`). `test/import-graph.test.mjs` walks the import graph of every entry point and `lib/**` and fails if one reaches those folders. Only Astro pages are exempt: they are the product. In particular `src/domain/presupuesto.js` is also in the **browser bundle** of the calculator (public and human-reviewed, since `src/domain/**` is `human`); that is intended.
  (1) The static check rejects, before anything runs, any `node:` import, `fetch`, `eval`, `Function`, `process`, `globalThis`, `global`, `require`, `constructor`, dynamic `import()`/`import.meta`, any `\u` or `\x` escape (an identifier spelled with escapes would pass a word list), non-ASCII characters outside strings and comments, and any import outside `src/domain/` and `src/features/` (tests may import `node:test` and `node:assert`; specifiers with `?`, `#`, `%` or `\` are rejected). (2) Then the tests of the domain and the features, the sample quotes and the feature contract run in a throwaway copy with **no `.git`, no `node_modules`, an empty environment (only `PATH`; the model key and the GitHub tokens are not there), a read-only view of that copy only** (Node permission model: no writes, no child processes, no network), `--disallow-code-generation-from-strings`, no `fetch`, 384 MB and a **60 s limit** after which the run is killed and the task is rejected. The verdict is not the exit code: a reporter says which test files ran to the end and how many tests passed, and a run that ends early, a file without tests or a skipped test is not a pass. Every run that reads an answer (the reporter, the feature runner, the state check) gets a random marker through **stdin**, which the trusted runner reads before any code under test loads: no file of the copy holds it, so the code under test can neither read it nor forge the answer. The answer of a feature is only accepted if its `id` is the one being evaluated. **Two processes per suite**: the trusted tests (the repository's own, the sample quotes, the feature contract) share their process with nothing but the code under test; the test files the model wrote (the patch, and any earlier `tarea-*` tests) run in a separate process, so a test that patches what it shares cannot touch the trusted verdict. Inside the isolation `node:assert` is frozen and Node runs with `--frozen-intrinsics` (`JSON`, `RegExp`... cannot be patched); its experimental warning is filtered from the captured output. The static check also rejects any `from '…'` it cannot read as an allowed import (`export{x}from'fs'` included). Known and accepted: sandboxed code can signal its parent (`process.kill(process.ppid, …)`); the worst case is that the factory or the build dies, which fails closed (nothing is merged or published). **The network switch (`--allow-net`) exists only from Node 26: the sandbox refuses to run model code on any other Node** (fail closed, clear error), and `.node-version` is 26 for CI, the factory and the gate. Test: `test/sandbox.test.mjs` (canary variable, writes, spawn, reads outside, eval, loops, memory, escapes, early exit, forged lines, refusal without the switch).
- **Tests of `src/` in CI.** `npm test` runs `test/*.test.mjs` only; the tests of the domain and the features (model-written) run in CI through the sandbox (`test/sandbox.test.mjs`, baseline). `npm run test:src` runs them by hand, outside the isolation, for the people who write them. No file of `test/` imports `src/domain/` or `src/features/` (CI has secrets in reach): they go through `checkState`/`runSuite` or read the files as text, and `test/import-graph.test.mjs` enforces it (the feature contract, `src/features/contrato.js`, is platform and exempt). The Builder is told to write deterministic tests (no dates, randomness, timers).
- **Gate.** `src/features/*/index.js` and `index.test.mjs` are `auto` (they reach production by themselves if CI, the `build` check, passes: it runs the same tests); `src/domain/**` is `human`; the rest of `src/` is the platform (`human`). The strictest route in the diff wins.
- **Planted bugs** (the starting state; `reset-demo` restores them from `factory/seed/src/`): the feature `ordenar-catalogo` ("Del más barato al más caro") lists the dearest first, and the discount is not applied at the exact kilos of a tier (1.000 kg in the calculator: `<` instead of `<=` in `src/domain/presupuesto.js`). Their exact tests were left out, so CI is green with the bugs. A third one is visual: the landscape of the home hero fills the whole hero and climbs behind the text and the buttons (`src/components/Paisaje.astro`, `.hero` and `.paisaje` in `src/styles/global.css`, restored from `factory/seed/src/`); `design/system.md` lists it under *Known deviations*. The static check rejects malicious attempts (`process.env`, `fetch`, `import('node:fs')`, `eval`).

## The look of the site

A request such as *"el botón del hero no se ve bien"* is the kind **`estilo`**: the look is wrong (layout, spacing, sizes, contrast, how the illustration sits) and the factory fixes it, using only the design system (`design/system.md`, human-only), which the agents and the reviewers read.

- **Surface** (`factory/kinds.yaml`, `visual: true`): exactly `src/styles/global.css` and the presentational components `src/components/Paisaje.astro`, `CampanaCard.astro`, `ProductoCard.astro`, `Header.astro` and `Footer.astro`. Existing files only (a new `.astro` is never allowed), at most 2 files; the answer is the whole text of a file or exact edits (`cambios`), like code.
- **Static check** (`lib/estilo.js`, text only, run by the build and again by `codigo`; nothing unsafe is written or rendered). *Stylesheet*: no `@import`, `url(` (no exceptions), image functions, `expression(`, `javascript:`, `behavior:`, `-moz-binding`, `</style`, `://` or backslash escapes. *`.astro`* is code, so only markup, classes, attributes with literal values and SVG shapes may change: the frontmatter must be byte-identical, the template expressions `{…}` must be the same multiset (they may move, not change) and keep their context (the text, or the same attribute: audience text never lands in `style` or `href`), the inline scripts already in the file stay byte for byte, and `<script`, `set:html`, `set:text`, `is:inline`, `is:raw`, event handlers, `javascript:`, `data:`, `://`, `//`, `<iframe`, `<object`, `<embed`, `<link`, `<meta`, `<base`, `<form`, `<slot`, `<style`, `<image`, `<use`, `import`, components not already used, and links that are not a path of the site are refused. *Never what the site says*: no new quoted string in the stylesheet (`content`), and the words of a component (text and `alt`, `title`, `aria-label`…) stay the same.
- **The reviewers see the site** (`lib/render.js`, kept for the reviewer agents). After the build check (so only after the static check passed) the candidate is rendered: a throwaway copy of the repository (no `.git`, `node_modules` linked) with the candidate files laid over it, built there (feature registry, then `astro build`), served on `127.0.0.1` (port 0) and photographed by a headless Chromium-family browser (`--headless=new --screenshot`, `--virtual-time-budget` so the entrance animations finish). Six shots, one constant (`SHOTS`): the home before and after the change at 1280×800 and 390×844, plus the catalogue and the quote page after, at 1280×800. The visual reviewers get the labelled shots. Every child process (build, browser) runs with an **empty environment** (`PATH`, and `HOME` and `TMPDIR` inside the scratch directory: never the model key or a GitHub token), with a time limit (120 s per build, 30 s per shot), and the scratch directory is always removed. A candidate that does not build, or a missing browser or a failed shot, is a `RenderError` (the caller fails closed). The browser is `FACTORY_BROWSER` (a name or a path), else the first of `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `brave` on the `PATH` (Brave does not take command-line screenshots on every system: prefer Chrome or Chromium).
- **No measured visual checks in code.** Colour, contrast and overlap are not computed: the visual reviewers judge what they see in the screenshots against the design system.
- **Gate.** The six files are `auto` in `policy/risk.yaml` (placed before the `src/**` rule: first match wins); every other file under `src/` stays `human`.
- **Planted bug.** The home hero is broken on purpose (`.hero`, `.hero__tarjeta`, `.hero__campo` and `.hero__disco` in `global.css`, whole rules; `reset-demo` restores them from `factory/seed/src/`): the picture field leaves its grid cell and spreads over the whole hero, so the cut lemon climbs behind the heading and the buttons and the Vega photograph lands on the origins. `design/system.md` ("Known deviations") describes it.

## Following a request

`GET /api/estado` (Pages Function) lists the issues labelled `entrada` (1 call) and the open PRs labelled `necesita-humano` (1 call, through the issues endpoint, so Issues: read is enough), parses each state marker with the same rules as `parseState`, caches the whole answer 10 s (Cache API, in-memory fallback) and returns `{tareas, cola, contadores, actualizado}`; `?tarea=N` filters (404 `{error}` if unknown). It never returns request text beyond the issue title, tokens or GitHub errors (502 with a generic message).

`resultadoFinal` is derived: `desplegada` (production confirmed), `rechazada` / `fallida` / `sin_cambios` (the factory result, with `motivo`), `cerrada` (PR closed without merge), `esperando_persona` (PR in the queue, or routed to a human and not approved yet), `en_curso` (everything else, including merged and waiting for the deploy).

Production is confirmed without new permissions: `npm run build` writes `dist/deploy.json` (`{commit, builtAt}` from `CF_PAGES_COMMIT_SHA`, or `git rev-parse HEAD` locally), `gate.mjs --closed` stores the PR's `mergeCommit`, and for merged tasks not yet in production the API reads its own `/deploy.json` and asks `GET /repos/{repo}/compare/{mergeCommit}...{deployed}`: `identical` or `ahead` means deployed (cached for the life of the worker); `behind`/`diverged` keeps waiting.

Pages: the home, the catalogue, the quote calculator and `/tarea/` are the LIMONIA editorial site (the cut lemon as one disc; design in `design/web-limonia/`, rules in `design/system.md`; League Spartan and Figtree self-hosted from `public/fonts/`, the photographs from `public/fotos/`; no credits or licences are shown). The request form (*Pide un cambio*) and *Tus peticiones* live on `/factory/`, below the board (the header and footer button *Pedir un cambio* links to `/factory/#pide`; the home only points to it): the form saves the task numbers in `localStorage` (`limonia:tareas`, last 20) and links to `/tarea/?n=N`; the Turnstile script loads only there. `/tarea/` shows a dial and the stations vertically with the final message; it shows the kind the Spec writer gave the request (`tipo`), and when deployed it links to where the change shows, by kind (campaign → `/`, product or destination → `/catalogo/`, prices, discounts, transport, rule change → `/presupuesto/`, a look fix, a feature or a bug → `/`). `/factory/` is the live flow diagram (design in `design/factory-diagrama/01-diagrama.html`, system in `design/system.md`). The diagram (11 stations, the gate with its `AUTO` and `PERSONA` exits, `Main`, `PR`, `Producción`, the dashed loop back to Build and the `Rechazadas` terminal) is drawn on the server from `src/lib/geometria.js`, in two layouts: horizontal from 1500 px (it fills the window under the header, no page scroll at 1920×1080; the form and the footer are below it) and vertical below (laptops and phones, the detail becomes a bottom sheet). It polls `/api/estado` every 5 s (`?demo=1&paso=N` for the rehearsal) and the client script only moves keyed tokens, one per request, along the connectors (Web Animations API, 480 ms per station, `prefers-reduced-motion` gets the same states without travel), updates the counters, the queue and the panels; it never repaints the whole board. A request whose `vueltas` grew travels the dashed loop; the gate sends it along `AUTO` or `PERSONA` by `ruta`; refused, failed, closed or test-blocked requests end in `Rechazadas` (from `resultadoFinal`) and deployed ones in `Producción`. A rejection stays on the diagram 30 s with its `motivo`, a deployed one 4 s, the followed request stays. Tap a token (or type its number in *Sigue tu petición #*, or `?n=N`) and its path lights up while a panel shows its title, profile, kind, the 11 stations with ✓ ● ! –, the `motivo` and the PR link; tap a station for what it does and the requests in it; `Esc` closes. Every text from the API is painted with `textContent`.

**The board explains itself** (`odd/tasks/tablero-explica.md`). Every text that explains the factory lives in one module, `src/lib/explica.js` (pure, unit-tested in `test/explica.test.mjs`): to change what the board says, change it there. (1) *What each station does*: every box of the diagram shows a **MODELO / CÓDIGO / PERSONA** marker (the word, not only a colour) and its one line, in both layouts; the panel of a tapped station repeats them with the longer explanation. (2) *What happens to my request*: when you follow one (`?n=N`, the form or a tap) the panel leads with a plain sentence of what is happening now ("Cuatro revisores miran tu cambio a la vez…"), then the 11 steps as a timeline (✓ ● ! – plus one phrase each), the final message, the `motivo` of a refusal, the PR link, and "El Approver la devolvió a Build una vez…" when `vueltas` says so. It is built only from what `/api/estado` returns (`estaciones`, `ruta`, `pr`, `resultadoFinal`, `motivo`, `vueltas`, `tipo`): the reason of each station is not stored, so no step claims one. The polite live region announces the same sentence when the request moves. (3) *A guide for the public*: the **¿Cómo funciona?** button opens a tour of 8 steps ("1 de 8: Entrada…" to Producción; the four reviewers are one step and the gate is one step) that outlines each station on the diagram and dims the rest, with Anterior / Siguiente / Saltar, `←` `→` `Esc`, focus kept inside and returned on close. It opens by itself only the first time (`localStorage` `limonia:recorrido-visto`), only below 1500 px (a phone from the QR), never in demo mode and never when the URL follows a request (`?n=`); `?recorrido=N` opens it at step N. Texts are tú-form, short, and set with `textContent`. The pure logic (node of a token, path, marks, panel rows, counters, retention) lives in `src/lib/tablero.js` and `src/lib/geometria.js`, unit-tested in `test/tablero.test.mjs`.

`/api/estado` returns `vueltas` (0-2) per task, so the board knows when a request went back to Build; a state written before the field existed derives `0`. On a retry the state shows Builder `en_curso` and the reviewers and the approver `pendiente`.

## The agent image

Each agent works one task in a throwaway container (`factory/agente/Dockerfile`): Node 26, git, Chromium (for the screenshots), Claude Code at an exact version and the repository's npm dependencies, installed once in `/opt/limonia/node_modules`. It runs as a non-root user and holds **no credential**: the model key never goes in the image; it is added from outside (a proxy, `ANTHROPIC_BASE_URL`). The entry point links the dependencies into the mounted copy of the repo (`/work`) and runs the command it is given.

```bash
npm run agente:imagen   # builds limonia-agente:dev
npm run agente:medir    # start-up times: 5 bare starts, claude --version, node --version, npm run build
```

## The model proxy

The agent container never holds the maintainer's credential. Claude Code runs with `ANTHROPIC_BASE_URL=http://limonia-proxy:8787` and a per-task token; the proxy (`lib/proxy.js`, standard library only) holds the real credential and forwards only `POST /v1/messages` and `/v1/messages/count_tokens` to `https://api.anthropic.com`, only for models whose name starts with `claude-haiku-` (`PROXY_MODELOS`, comma-separated, to change it). It strips every incoming auth header, sets the real one, and logs one line per request (task, model, status, ms, tokens), never headers or bodies.

- **Credential**: a file outside the repo, `~/.config/limonia/claude-credencial` (or `LIMONIA_CREDENCIAL`), refused unless only its owner can read it (600 or 400), never read from argv. An API key (`sk-ant-api…`) goes as `x-api-key`; a subscription token from `claude setup-token` (`sk-ant-oat…`) as `Authorization: Bearer` plus `anthropic-beta: oauth-2025-04-20`. The API-key path and the OAuth header shape are tested against a fake upstream; **the OAuth path is to be verified live** (what the upstream accepts for a subscription token, and whether Claude Code needs other betas, which are passed through).
- **Tokens**: the orchestrator asks for one per task on the admin unix socket (`$XDG_RUNTIME_DIR/limonia/proxy-admin.sock`, mode 600, never mounted into agents): `POST /tokens {"tarea": 7, "ttl_s": 1800, "max": 300}` returns `{"token": …}`; `DELETE /tokens/7` revokes. A token expires (default 30 min) and has a request budget (default 300), then the proxy answers 401 or 429. The agent sends it as `ANTHROPIC_AUTH_TOKEN` (Bearer) or `ANTHROPIC_API_KEY` (`x-api-key`).
- **Refused (403, nothing forwarded)**: a body with `mcp_servers`, `container`, a `source` of type `url` anywhere (an image or document Anthropic would fetch), or any tool whose `type` is not `custom` (server-side tools such as web fetch/search, code execution or the bash/editor server tools make Anthropic's servers act outside the internal network); an `anthropic-beta` value outside the list `ALLOWED_BETAS` in `lib/proxy.js` (taken from the beta strings in the pinned Claude Code binary, keeping only those that shape a plain messages call, plus the two Claude Code 2.1.316 sends on every request, seen live; a Claude Code update that needs another shows up as `status=403` in the log and is added on purpose). Redirects from upstream are never followed (502), the forwarded body is the parsed JSON re-serialised, and only content-type, request-id, retry-after, cache-control and `anthropic-ratelimit-*` response headers reach the agent. A request can never crash the proxy (400/500 instead), and a request body must arrive within 30 s.
- **Network**: agents join only `limonia-agentes`, a Docker `--internal` network (no route out). The proxy runs as a container on that network and on the default bridge, so it is the only thing agents can reach. The orchestrator goes further: each task gets its own `--internal` network `limonia-t<n>`, the proxy is connected to it for the task's life, so agents cannot reach each other. (A host process bound to the network's gateway is not reachable from containers on Docker 29.)

```bash
npm run proxy:red                 # create the internal network
npm run proxy                     # run the proxy container (foreground)
npm run proxy:red -- check        # from an agent container: internet fails, the proxy answers
```

## The orchestrator: `npm run fabrica`

The factory is off until you switch it on. It needs the proxy running (`npm run proxy`, it refuses to start otherwise), the image (`npm run agente:imagen`) and `gh` logged in as the repository owner.

```bash
npm run fabrica                       # up to 3 agents at once
npm run fabrica -- --paralelo 1 --una-vez --limpiar
```

Options: `--paralelo N` (1-6, default 3), `--modelo` (default `claude-haiku-4-5`), `--tiempo MIN` (wall clock per task, default 10), `--turnos N` (default 40), `--sondeo S` (queue check, default 10 s), `--limpiar` (remove each copy at the end), `--una-vez` (stop when the queue is empty).

- **One instance**: a lock in `$XDG_RUNTIME_DIR/limonia/fabrica.lock` (pid; a dead pid is taken over).
- **Queue**: the open issues labelled `entrada` filed by the repository owner, oldest first. Pending = not claimed, or claimed by a run that is gone (no PR, not finished): it restarts from scratch. On start it reconciles the queue, then checks every ~10 s. The rest wait for a free slot.
- **Claim**: before anything starts, the task state (`<!-- factory:state … -->`, written only by the scripts) gets `spec` and `build` `en_curso`; the reviewers, approver, gate and merge stay `pendiente`. At the end: `ok` (both `ok`, no result yet), `rechazada` (`spec` refused, result `rejected`, the agent's one-line reason) or `fallida` (`build` `error`, result `failed`, a fixed reason: time out, no valid `resultado.json`, no commit, agent error).
- **Per task**: a self-contained copy of `origin/main` (`git init` + fetch of that one ref: no remote, no hard links, no local-only commits) in `~/.local/state/limonia/tareas/t<n>` on branch `tarea/<n>`; a network `limonia-t<n>` (`--internal`) with the proxy connected; a proxy token that expires about a minute after the time limit and is revoked at the end (success, failure or timeout); a container `limonia-agente-t<n>` (`--rm`, that network only, copy at `/work`, `--cap-drop ALL`, `no-new-privileges`, 2 CPUs, 2 GB, 512 pids, tmpfs home, the host user's uid) running `claude -p` with the playbook `factory/agente/playbook.md` and the request fenced as data. The token reaches the container through the environment of `docker` (`-e ANTHROPIC_AUTH_TOKEN`, no value in argv); the real credential is never near the orchestrator.
- **Ctrl+C**: once, no new tasks and the running ones finish; twice, the containers are killed, their claims released back to the queue and their copies removed.
- **The view for the presenter**: one line per step (`#7 Edit content/campanas/tarea-7.json`), the short trace of each task is kept in `~/.local/state/limonia/tareas/t<n>.traza.txt`.
- **Outcome**: the agent writes `/work/.fabrica/resultado.json` (`{ "estado": "ok" | "rechazada" | "fallida", "resumen": "…" }`); the orchestrator validates it (size, shape, plain text) and reads it only if it is a regular file inside the copy. It then lists the commits and files of `tarea/<n>` against the commit the copy started from, records the state and prints where the copy is. It does not push or open a pull request yet (T5).

## Run it locally (free, offline)

```bash
npm install
npm test                       # everything, including workflow structure checks
npm run gate -- content/campanas/tarea-1.json config/transporte.json data/precios.json
npm run build                  # → dist/
```

## The demo twist (on purpose)

`policy/risk.yaml` fails closed (`default: human`: anything no rule names waits for a person) and protects `data/` (prices and discounts), but it has an explicit rule that sends `config/**` to `auto`: transport costs were taken for plain data, like the catalogue. A Negocio request such as *"Pon el transporte a Alemania gratis"* edits `config/transporte.json`, passes the checks (every sample quote still works) and **merges without a human**: the calculator now quotes free transport to Germany for everyone. The issue's trail shows why: the gate took the `config/**` rule.

The fix is one line, no prompt touched, in that rule:

```diff
   - paths: ["config/**"]
-    route: auto
+    route: human
```

Run `npm run preflight` before the talk: it checks the hole is open (the `config/**` rule is `auto`), the default is `human`, `factory` is set and the transport to `alemania-hamburgo` is back at the seed value (`factory/seed/config/transporte.json`).

Re-run the request **asking for something that is not there yet** (e.g. *"Pon el transporte a Alemania a 0,05 euros por kilo"*): asking for the value that is already there ends as `unchanged` and opens no PR. It is now blocked, waiting for a person. *"No he arreglado esta tarea. He arreglado las cien siguientes."*

The tests do not pin the hole: they check the mechanism (`config/` takes the route of its rule, whatever its value), so the fix does not turn CI red. `npm run preflight` is what warns if the hole is closed by accident.

## Setup (once)

### 1. GitHub repository

1. Create a **public** repository and push `main`.
2. Create the labels: `entrada`, `perfil:marketing`, `perfil:producto`, `perfil:negocio`, `necesita-humano`.
3. Settings → General → enable **Allow auto-merge**.
4. Settings → Branches → protect `main`: require a pull request, require the status checks **`risk-gate`** and **`build`**. Leave admin bypass allowed: the live policy fix is pushed straight to `main` by you (GitHub does not let you approve your own PR, and `policy/` always needs a human).
5. Put your GitHub login under `approvers` in `policy/risk.yaml`.
6. Set `factory:` in `policy/risk.yaml` to the login of the App bot from step 2, `<app-slug>[bot]` (this repository uses `murciatech-factory[bot]`; in a fork it **must match your own App slug**). The gate auto-merges only pull requests opened by that bot from a branch of this repository; anything else (a fork, another author) needs an approver. If `factory` is empty, nothing auto-merges.
7. Settings → Actions → General → Fork pull request workflows: enable **Require approval for all external contributors**.

After an approver approves a blocked PR, the review event re-runs the original `risk-gate` run (same-repository PRs only; for a fork PR, re-run it by hand after approving), which reads the approval and passes, but it does not merge: a human merges. When the gate does merge (factory PRs on the auto route), it pins the commit it judged, so a later push cancels the merge.

### 2. GitHub App (the factory's identity)

PRs opened with the default `GITHUB_TOKEN` do not trigger workflows, so the factory opens them as an App.

1. Create a GitHub App (no webhook). Repository permissions: **Contents**, **Pull requests** and **Issues**: read and write.
2. Install it on the repository only.
3. Repository secrets: `FACTORY_APP_ID`, `FACTORY_APP_PRIVATE_KEY`.

### 3. Model

The agents are Claude Code in containers, run by `npm run fabrica` on the maintainer's PC through the model proxy (see above). No model key lives in GitHub.

### 4. Cloudflare Pages (site + intake)

1. Create a Pages project from the repository. Build command `npm run build`, output directory `dist`. The `functions/` folder is picked up automatically.
   **Set the build environment variable `NODE_VERSION` = `26`** (Settings → Variables and Secrets → Production *and* Preview, type *Plaintext*). The build runs `scripts/validate-content.mjs` and `scripts/build-features.mjs`, which evaluate the domain and the features in the sandbox, and the sandbox refuses to run on a Node without the network switch (before 26): with an older Node the build fails with an explicit message instead of running model code.
   **Production is deployed by `.github/workflows/deploy.yml`, not by Cloudflare's git builds**: Cloudflare builds one push at a time, so a burst of merges during the talk would queue one build per merge. In the project, turn off automatic deployments on every branch (Settings → Builds → Branch control: production and preview), so neither `main` nor the `tarea/*` branches build there. The workflow builds on each push to `main` (a newer push cancels a build in progress), uploads `dist` and deploys it with `wrangler pages deploy`; a burst of merges ends in one or two deploys. The build job holds no secret (the site build runs code a model wrote); the upload job holds the token and runs no repository code. GitHub: secrets `CLOUDFLARE_API_TOKEN` (an API token with **Cloudflare Pages: Edit** only) and `CLOUDFLARE_ACCOUNT_ID`; variables `TURNSTILE_SITE_KEY` (public, read at build time) and optionally `CLOUDFLARE_PROJECT` (default `charla-factory-demo`). The variables below stay in Cloudflare: the functions read them at run time.
2. Create a Turnstile widget for the site's domain.
3. Environment variables (production):

| Variable | Value |
|----------|-------|
| `TURNSTILE_SITE_KEY` | Turnstile site key (used at build time: also a GitHub repository variable, for `deploy.yml`) |
| `TURNSTILE_SECRET` | Turnstile secret key |
| `GITHUB_TOKEN` | Fine-grained token, this repository only, **Issues: read and write**, nothing else (also read by `/api/estado`) |
| `GITHUB_REPO` | `owner/repo` |
| `INTAKE_OPEN` | `1` to accept requests, anything else closes the form (kill switch) |
| `INTAKE_TEST_KEY` | Secret, at least 32 characters: your rehearsal pass while the form is closed (see below). Absent or shorter = no pass for anybody |
| `INTAKE_MAX_TASKS` | Task cap, default `15`, **max `100`** (higher values are clamped; the check is not atomic, so a burst can overshoot slightly) |

Issues are created with your token, so the factory only accepts issues authored by the repository owner.

## On the day

```bash
GITHUB_REPOSITORY=owner/repo FACTORY_PRICE_IN=<€/M> FACTORY_PRICE_OUT=<€/M> npm run numbers
```

prints the closing numbers: requests, in production, waiting for a person, rejected, failed, tokens, cost and mean time.

## Spending and switches

The repository is public, but no key is in it: they live in GitHub Actions secrets and Cloudflare environment variables. Nothing in GitHub calls a model any more (the factory is being rebuilt, off by default), so the one switch is the form:

| Switch | Turns off | How | Takes effect |
|--------|-----------|-----|--------------|
| `INTAKE_OPEN` in Cloudflare | The form ("La factory está cerrada") for everyone without the rehearsal pass | Set `0` or `1`, then redeploy | About a minute |

### Rehearsing from the web while the form is closed

With `INTAKE_OPEN=0` the form answers "La factory está cerrada" to everyone except a browser holding the rehearsal pass:

1. Generate a key (`openssl rand -hex 24`) and store it in Cloudflare as the secret `INTAKE_TEST_KEY` (Production), then redeploy.
2. On each device you rehearse from, open `https://<site>/api/acceso?clave=<key>` once. It sets an `HttpOnly`, `Secure`, `SameSite=Strict` cookie on `/api` (an HMAC of the key, never the key itself; the browser keeps it 30 days, but the server accepts it for as long as the key is unchanged) and sends you to the home page.
3. Use the form as the audience will: Turnstile and `INTAKE_MAX_TASKS` still apply.

`/api/acceso?salir` removes the pass from that browser; changing or deleting `INTAKE_TEST_KEY` (and redeploying) revokes every pass. The key travels once in a URL, so it may stay in that browser's history and in Cloudflare's request logs: use a fresh one per rehearsal period, and always after the talk.

Before the talk: `npm run reset-demo -- --apply` (removes the audience's content and features, restores the seed data and the planted bugs, reopens the hole (the `config/**` rule back to `auto`, the default always `human`), closes factory PRs and frees the board), then `npm run preflight`, start the factory (once the orchestrator exists), set `INTAKE_OPEN=1`.

Load test (needs a running factory): `npm run carga -- --n 9 --dry-run` shows what it would file; `npm run carga -- --n 9 [--json] [--timeout-min M]` files the requests and reports, per stage (start, PR opened, merged, deployed), the median, p90 and max. Run `npm run reset-demo -- --apply` afterwards.

After the talk: set `INTAKE_OPEN=0`, stop the factory, revoke the intake's GitHub token, and delete `INTAKE_TEST_KEY`.

Also recommended: a Cloudflare rate-limiting rule on `/api/peticion` (a few requests per minute per IP).

## License

Not decided yet.
