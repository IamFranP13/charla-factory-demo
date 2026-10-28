# charla-factory-demo

A tiny AI factory, built for the talk *Vibe Engineering a escala de empresa*.

The audience scans a QR code and asks for a change to this website. A chain of cheap agents builds it. A **risk gate written in code, not in a prompt** decides whether the change goes straight to production or waits for a human.

The whole platform is a couple of thousand lines of plain JavaScript and three workflows. That is the point of the talk: **an AI factory is not an AI problem, it is a platform problem.**

## How it works

```
QR → form (src/pages/) → Pages Function (functions/api/peticion.js) → GitHub issue labelled "entrada"
                                                                        ↓
              factory.yml: spec (+ brain/) → build → seguridad · ux · ui · codigo in parallel → approver
              (one loop back to build) → pull request. Every station comments on the issue (the audit
              trail) and updates the task state kept in the issue body
                                                                        ↓
              gate.yml: scripts/gate.mjs reads policy/risk.yaml and the PR's changed files
                    ↓                                               ↓
            low risk → auto-merge                      high risk → blocked until an approver approves
                    ↓
            Cloudflare Pages deploys main (produccion)
```

| Piece | Where | What it shows |
|-------|-------|---------------|
| Profiles | `factory/profiles.yaml` | Who asked: Marketing, Producto or Negocio, drawn at random by the server. Only a label (and the fallback kinds if the spec names none): it does not limit what a request can be. |
| Kinds | `factory/kinds.yaml` | What a request IS, named by the Spec writer: `campana` (`content/campanas/`), `producto` and `destino` (`catalogo/`), `precios`, `descuentos`, `transporte` (`data/precios.json`, `data/descuentos.json`, `config/transporte.json`) and the three code kinds `bug`, `feature`, `cambio` (`src/features/`, `src/domain/`). The kind decides the surface; code enforces it. |
| Stations | `lib/factory.js`, `factory/prompts/`, `brain/`, `design/` | `spec` reads the Brain (brand, tone, decisions, human-only) · `build` · `seguridad`, `ux`, `ui` (models, in parallel; `ux` and `ui` also judge against the design system, `design/system.md`, human-only) and `codigo` (code, no model: schemas, catalogue rules and every sample quote in `factory/muestras.json`; for code, the static check and the isolated tests, see *Code from the audience*) · `approver` (code: 4/4 or back to `build` once). Models only fill in content; code chooses paths and keeps score. |
| Task state | `<!-- factory:state {...} -->` in the issue body | One station map per task (`pendiente`, `en_curso`, `ok`, `rechazada`, `error`) for the board. Written only by `scripts/factory.mjs` and `scripts/gate.mjs`, rendered from known fields (model text can never reach it). `puerta` and `merge` are set by the gate. Optional `tipo` (the kind, one of `factory/kinds.yaml`), `motivo` (plain text, at most 160 characters: why a station refused or failed) and `mergeCommit` (the PR's merge commit, 40 hex). `produccion` is confirmed by `/api/estado`, not stored (see *Following a request*). The pure helpers live in `lib/estado.js`. |
| Follow-up | `functions/api/estado.js`, `lib/estado.js`, `/tarea/?n=N`, `/factory/` | `GET /api/estado` is the one read the pages poll every 5 s: the task of each request, the queue waiting for a person and the counters. See *Following a request*. |
| Risk gate | `policy/risk.yaml`, `lib/policy.js`, `scripts/gate.mjs` | Decides by **what the diff touches**, never by who asked. Safe changes merge by themselves (campaigns, catalogue, a feature, if CI passes); risky ones wait for a human (prices, discounts, the domain, the platform). Fails closed. Approvals count only on the current head. |
| Code | `lib/sandbox.js`, `src/features/`, `src/domain/`, `scripts/build-features.mjs` | Small code written by the factory, with its isolation. See *Code from the audience*. |
| Models | `lib/providers.js` | `replay` (deterministic fake model, free, offline) or any OpenAI-compatible API. Reviewers can use another model (`FACTORY_REVIEW_MODEL`) and so can the Builder of code (`FACTORY_CODE_MODEL`, optional). |
| Intake | `lib/intake.js` | Requests of at most 150 characters; the server draws the profile at random, in equal parts. Turnstile, a task cap and a kill switch. Input is data, never instructions. |
| Shared rules | `AGENTS.md` | The same rules for the factory agents and for a local harness (Pi, Claude Code, OpenCode…). |

## Code from the audience

Any request can be small code: **`bug`** (a fix in a feature or in the domain), **`feature`** (a new section of a page) or **`cambio`** (a business rule). The Spec writer names the kind; the profile does not matter.

- **Surface** (checked by code, `lib/sandbox.js` `codePathError`): `src/features/<id>/index.js` + `index.test.mjs` (a new feature goes in `src/features/tarea-<n>/`, named by the factory; or an existing one, for a bug) and `src/domain/*.js` + `*.test.mjs` (existing files, or new ones named `tarea-<n>...`). `feature` only touches features, `cambio` only the domain, `bug` either. At most 3 files; the model answers either the whole text of a file or exact edits (`cambios: [{buscar, reemplazar}]`, each `buscar` must match once) that the factory applies.
- **Contract of a feature** (`src/features/contrato.js`): `export default { id, titulo (≤ 60), donde: 'inicio'|'catalogo'|'presupuesto', calcular(estado) }`. `calcular` is pure and returns data: `{tipo: 'lista', items}`, `{tipo: 'tabla', columnas, filas}` or `{tipo: 'texto', texto}` (plain text, ≤ 40 rows). One generic component (`components/Features.astro`) paints it with escaped text.
- **The registry** is generated at build time (`scripts/build-features.mjs`, runs in `npm run build` and `npm run dev`; `src/features/index.js` is not committed). Every feature is computed **inside the isolation** and the site only receives the data it returned: it never imports the code of a feature. A feature that does not load, breaks the contract, throws or hangs is skipped with a warning; the build never fails because of it.
- **Isolation guarantee.** Nothing a model writes is imported by the factory, the gate or the site's build. `src/domain/` and `src/features/` are code a model can change (a `bug` or `cambio` into `src/domain/`, a human route), and the processes that run with secrets in reach (the factory job with the model key, the gate with a write token, the Cloudflare build with the Turnstile secret and the issues token) must never load it. So **platform code (`lib/`, `scripts/`, `functions/`) never imports `src/domain/` or `src/features/`**: validating the catalogue (`validateCatalog`), quoting the sample orders (`presupuestar`), the `codigo` station and the feature registry all run the domain inside the isolation and only read JSON back (`checkState`, `runSuite`, `evaluateFeatures` in `lib/sandbox.js`). `test/import-graph.test.mjs` walks the import graph of every entry point and `lib/**` and fails if one reaches those folders. Only Astro pages are exempt: they are the product. In particular `src/domain/presupuesto.js` is also in the **browser bundle** of the calculator (public and human-reviewed, since `src/domain/**` is `human`); that is intended.
  (1) The static check rejects, before anything runs, any `node:` import, `fetch`, `eval`, `Function`, `process`, `globalThis`, `global`, `require`, `constructor`, dynamic `import()`/`import.meta`, any `\u` or `\x` escape (an identifier spelled with escapes would pass a word list), non-ASCII characters outside strings and comments, and any import outside `src/domain/` and `src/features/` (tests may import `node:test` and `node:assert`; specifiers with `?`, `#`, `%` or `\` are rejected). (2) Then the tests of the domain and the features, the sample quotes and the feature contract run in a throwaway copy with **no `.git`, no `node_modules`, an empty environment (only `PATH`; the model key and the GitHub tokens are not there), a read-only view of that copy only** (Node permission model: no writes, no child processes, no network), `--disallow-code-generation-from-strings`, no `fetch`, 384 MB and a **60 s limit** after which the run is killed and the task is rejected. The verdict is not the exit code: a reporter says which test files ran to the end and how many tests passed, and a run that ends early, a file without tests or a skipped test is not a pass. Every run that reads an answer (the reporter, the feature runner, the state check) gets a random marker through **stdin**, which the trusted runner reads before any code under test loads: no file of the copy holds it, so the code under test can neither read it nor forge the answer. The answer of a feature is only accepted if its `id` is the one being evaluated. **Two processes per suite**: the trusted tests (the repository's own, the sample quotes, the feature contract) share their process with nothing but the code under test; the test files the model wrote (the patch, and any earlier `tarea-*` tests) run in a separate process, so a test that patches what it shares cannot touch the trusted verdict. Inside the isolation `node:assert` is frozen and Node runs with `--frozen-intrinsics` (`JSON`, `RegExp`... cannot be patched); its experimental warning is filtered from the captured output. The static check also rejects any `from '…'` it cannot read as an allowed import (`export{x}from'fs'` included). Known and accepted: sandboxed code can signal its parent (`process.kill(process.ppid, …)`); the worst case is that the factory or the build dies, which fails closed (nothing is merged or published). **The network switch (`--allow-net`) exists only from Node 26: the sandbox refuses to run model code on any other Node** (fail closed, clear error), and `.node-version` is 26 for CI, the factory and the gate. Test: `test/sandbox.test.mjs` (canary variable, writes, spawn, reads outside, eval, loops, memory, escapes, early exit, forged lines, refusal without the switch).
- **Tests of `src/` in CI.** `npm test` runs `test/*.test.mjs` only; the tests of the domain and the features (model-written) run in CI through the sandbox (`test/sandbox.test.mjs`, baseline). `npm run test:src` runs them by hand, outside the isolation, for the people who write them. No file of `test/` imports `src/domain/` or `src/features/` (CI has secrets in reach): they go through `checkState`/`runSuite` or read the files as text, and `test/import-graph.test.mjs` enforces it (the feature contract, `src/features/contrato.js`, is platform and exempt). The Builder is told to write deterministic tests (no dates, randomness, timers).
- **Gate.** `src/features/*/index.js` and `index.test.mjs` are `auto` (they reach production by themselves if CI, the `build` check, passes: it runs the same tests); `src/domain/**` is `human`; the rest of `src/` is the platform (`human`). The strictest route in the diff wins.
- **Planted bugs** (the starting state; `reset-demo` restores them from `factory/seed/src/`): the feature `ordenar-catalogo` ("Del más barato al más caro") lists the dearest first, and the discount is not applied at the exact kilos of a tier (1.000 kg in the calculator: `<` instead of `<=` in `src/domain/presupuesto.js`). Their exact tests were left out, so CI is green with the bugs. Replay has patches for both, for three features (cheapest per category, transit days, average price per kilo) and for a rule change (15 % from 50.000 kg), plus malicious attempts (`process.env`, `fetch`, `import('node:fs')`, `eval`) that the static check rejects.

## Following a request

`GET /api/estado` (Pages Function) lists the issues labelled `entrada` (1 call) and the open PRs labelled `necesita-humano` (1 call, through the issues endpoint, so Issues: read is enough), parses each state marker with the same rules as `parseState`, caches the whole answer 10 s (Cache API, in-memory fallback) and returns `{tareas, cola, contadores, actualizado}`; `?tarea=N` filters (404 `{error}` if unknown). It never returns request text beyond the issue title, tokens or GitHub errors (502 with a generic message).

`resultadoFinal` is derived: `desplegada` (production confirmed), `rechazada` / `fallida` / `sin_cambios` (the factory result, with `motivo`), `cerrada` (PR closed without merge), `esperando_persona` (PR in the queue, or routed to a human and not approved yet), `en_curso` (everything else, including merged and waiting for the deploy).

Production is confirmed without new permissions: `npm run build` writes `dist/deploy.json` (`{commit, builtAt}` from `CF_PAGES_COMMIT_SHA`, or `git rev-parse HEAD` locally), `gate.mjs --closed` stores the PR's `mergeCommit`, and for merged tasks not yet in production the API reads its own `/deploy.json` and asks `GET /repos/{repo}/compare/{mergeCommit}...{deployed}`: `identical` or `ahead` means deployed (cached for the life of the worker); `behind`/`diverged` keeps waiting.

Pages: the form saves the task numbers in `localStorage` (`limonia:tareas`, last 20) and links to `/tarea/?n=N`; the home lists them under *Tus peticiones*. `/tarea/` shows the stations vertically and the final message; it shows the kind the Spec writer gave the request (`tipo`), and when deployed it links to where the change shows, by kind (campaign → `/`, product or destination → `/catalogo/`, prices, discounts, transport, rule change → `/presupuesto/`, a feature or a bug → `/`). `/factory/` is the big-screen board.

## Run it locally (free, offline)

```bash
npm install
npm test                       # everything, including workflow structure checks
npm run simulate               # the whole pipeline on a 47-request battery, replay model
npm run factory -- --profile marketing --request "Una campaña oliva que diga «Limones de temporada»" --id 1
npm run gate -- content/campanas/tarea-1.json config/transporte.json data/precios.json
npm run build                  # → dist/
```

With a real model:

```bash
FACTORY_PROVIDER=openai FACTORY_API_URL=https://api.deepseek.com FACTORY_MODEL=<model id> FACTORY_API_KEY=<key> \
  npm run simulate
```

## The demo twist (on purpose)

`policy/risk.yaml` protects `data/` (prices and discounts) but forgets `config/`, and its default is `auto`. A Negocio request such as *"Pon el transporte a Alemania gratis"* edits `config/transporte.json`, passes the four reviewers (`codigo` too: every sample quote still works) and **merges without a human**: the calculator now quotes free transport to Germany for everyone. The issue's trail shows why: the gate took the `default` rule.

The fix is one line, no prompt touched:

```diff
-default: auto
+default: human
```

Run `npm run preflight` before the talk: it checks the hole is open, `factory` is set and the transport to `alemania-hamburgo` is back at the seed value (`factory/seed/config/transporte.json`).

Re-run the request **asking for something that is not there yet** (e.g. *"Pon el transporte a Alemania a 0,05 euros por kilo"*): asking for the value that is already there ends as `unchanged` and opens no PR. It is now blocked, waiting for a person. *"No he arreglado esta tarea. He arreglado las cien siguientes."*

The tests do not pin the hole: they check the mechanism (`config/` takes the `default` route, whatever its value), so the fix does not turn CI red. `npm run preflight` is what warns if the hole is closed by accident.

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

Repository variables: `FACTORY_PROVIDER=openai`, `FACTORY_API_URL` (e.g. `https://api.deepseek.com`), `FACTORY_MODEL`, and optionally `FACTORY_CODE_MODEL` (the Builder of code; if unset the same model builds code, with room for longer answers). Secret: `FACTORY_API_KEY`. Use a prepaid account with a spending limit. Without these variables the factory uses the free replay model.

### 4. Cloudflare Pages (site + intake)

1. Create a Pages project from the repository. Build command `npm run build`, output directory `dist`. The `functions/` folder is picked up automatically.
   **Set the build environment variable `NODE_VERSION` = `26`** (Settings → Variables and Secrets → Production *and* Preview, type *Plaintext*). The build runs `scripts/validate-content.mjs` and `scripts/build-features.mjs`, which evaluate the domain and the features in the sandbox, and the sandbox refuses to run on a Node without the network switch (before 26): with an older Node the build fails with an explicit message instead of running model code.
2. Create a Turnstile widget for the site's domain.
3. Environment variables (production):

| Variable | Value |
|----------|-------|
| `TURNSTILE_SITE_KEY` | Turnstile site key (used at build time) |
| `TURNSTILE_SECRET` | Turnstile secret key |
| `GITHUB_TOKEN` | Fine-grained token, this repository only, **Issues: read and write**, nothing else (also read by `/api/estado`) |
| `GITHUB_REPO` | `owner/repo` |
| `INTAKE_OPEN` | `1` to accept requests, anything else closes the form (kill switch) |
| `INTAKE_MAX_TASKS` | Task cap, default `15`, **max `100`** (higher values are clamped; the check is not atomic, so a burst can overshoot slightly) |

Issues are created with your token, so the factory only accepts issues authored by the repository owner.

## On the day

```bash
GITHUB_REPOSITORY=owner/repo FACTORY_PRICE_IN=<€/M> FACTORY_PRICE_OUT=<€/M> npm run numbers
```

prints the closing numbers: requests, in production, waiting for a person, rejected, failed, tokens, cost and mean time.

## Spending and switches

The repository is public, but no key is in it: they live in GitHub Actions secrets and Cloudflare environment variables. Only one place can spend money on the model: the factory workflow. So there are two switches:

| Switch | Turns off | How | Takes effect |
|--------|-----------|-----|--------------|
| Factory workflow | Every model call, whatever created the issue | `gh workflow disable factory.yml` / `gh workflow enable factory.yml` | Immediately |
| `INTAKE_OPEN` in Cloudflare | The form ("La factory está cerrada") | Set `0` or `1`, then redeploy | About a minute |

Keep the factory workflow **disabled** whenever a real model key is configured and you are not rehearsing or presenting. Issues created while it is disabled are not processed later.

Before the talk: `npm run reset-demo -- --apply` (removes the audience's content and features, restores the seed data and the planted bugs, reopens the hole, closes factory PRs and frees the board), then `npm run preflight`, enable the factory workflow, set `INTAKE_OPEN=1`.

After the talk: set `INTAKE_OPEN=0`, disable the factory workflow, revoke the intake's GitHub token and the model key.

Also recommended once a real model key exists: a prepaid model account with a small balance (it is the last spending limit), and a Cloudflare rate-limiting rule on `/api/peticion` (a few requests per minute per IP).

## License

Not decided yet.
