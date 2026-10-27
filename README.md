# charla-factory-demo

A tiny AI factory, built for the talk *Vibe Engineering a escala de empresa*.

The audience scans a QR code and asks for a change to this website. A chain of cheap agents builds it. A **risk gate written in code, not in a prompt** decides whether the change goes straight to production or waits for a human.

The whole platform is about a thousand lines of plain JavaScript and three workflows. That is the point of the talk: **an AI factory is not an AI problem, it is a platform problem.**

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
| Profiles | `factory/profiles.yaml` | The company is LIMONIA. Marketing (campaigns in `content/campanas/`), Producto (a new product or destination in `catalogo/`), Negocio (prices, discounts and transport: `data/precios.json`, `data/descuentos.json`, `config/transporte.json`). Each one may only write in its places. |
| Stations | `lib/factory.js`, `factory/prompts/`, `brain/` | `spec` reads the Brain (brand, tone, decisions, human-only) · `build` · `seguridad`, `ux`, `ui` (models, in parallel) and `codigo` (code, no model: schemas, catalogue rules and every sample quote in `factory/muestras.json`) · `approver` (code: 4/4 or back to `build` once). Models only fill in content; code chooses paths and keeps score. |
| Task state | `<!-- factory:state {...} -->` in the issue body | One station map per task (`pendiente`, `en_curso`, `ok`, `rechazada`, `error`) for the board. Written only by `scripts/factory.mjs` and `scripts/gate.mjs`, rendered from known fields (model text can never reach it). `puerta` and `merge` are set by the gate. Optional `motivo` (plain text, at most 160 characters: why a station refused or failed) and `mergeCommit` (the PR's merge commit, 40 hex). `produccion` is confirmed by `/api/estado`, not stored (see *Following a request*). The pure helpers live in `lib/estado.js`. |
| Follow-up | `functions/api/estado.js`, `lib/estado.js`, `/tarea/?n=N`, `/factory/` | `GET /api/estado` is the one read the pages poll every 5 s: the task of each request, the queue waiting for a person and the counters. See *Following a request*. |
| Risk gate | `policy/risk.yaml`, `lib/policy.js`, `scripts/gate.mjs` | Decides by **what the diff touches**, never by who asked. Fails closed. Approvals count only on the current head. |
| Models | `lib/providers.js` | `replay` (deterministic fake model, free, offline) or any OpenAI-compatible API. Reviewers can use another model. |
| Intake | `lib/intake.js` | Requests of at most 150 characters; the server draws the profile at random, in equal parts. Turnstile, a task cap and a kill switch. Input is data, never instructions. |
| Shared rules | `AGENTS.md` | The same rules for the factory agents and for a local harness (Pi, Claude Code, OpenCode…). |

## Following a request

`GET /api/estado` (Pages Function) lists the issues labelled `entrada` (1 call) and the open PRs labelled `necesita-humano` (1 call, through the issues endpoint, so Issues: read is enough), parses each state marker with the same rules as `parseState`, caches the whole answer 10 s (Cache API, in-memory fallback) and returns `{tareas, cola, contadores, actualizado}`; `?tarea=N` filters (404 `{error}` if unknown). It never returns request text beyond the issue title, tokens or GitHub errors (502 with a generic message).

`resultadoFinal` is derived: `desplegada` (production confirmed), `rechazada` / `fallida` / `sin_cambios` (the factory result, with `motivo`), `cerrada` (PR closed without merge), `esperando_persona` (PR in the queue, or routed to a human and not approved yet), `en_curso` (everything else, including merged and waiting for the deploy).

Production is confirmed without new permissions: `npm run build` writes `dist/deploy.json` (`{commit, builtAt}` from `CF_PAGES_COMMIT_SHA`, or `git rev-parse HEAD` locally), `gate.mjs --closed` stores the PR's `mergeCommit`, and for merged tasks not yet in production the API reads its own `/deploy.json` and asks `GET /repos/{repo}/compare/{mergeCommit}...{deployed}`: `identical` or `ahead` means deployed (cached for the life of the worker); `behind`/`diverged` keeps waiting.

Pages: the form saves the task numbers in `localStorage` (`limonia:tareas`, last 20) and links to `/tarea/?n=N`; the home lists them under *Tus peticiones*. `/tarea/` shows the stations vertically and the final message; when deployed it links to where the change shows, by profile (Marketing campaign → `/`, Producto product or destination → `/catalogo/`, Negocio prices, discounts, transport → `/presupuesto/`). `/factory/` is the big-screen board.

## Run it locally (free, offline)

```bash
npm install
npm test                       # everything, including workflow structure checks
npm run simulate               # the whole pipeline on a 32-request battery, replay model
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

Repository variables: `FACTORY_PROVIDER=openai`, `FACTORY_API_URL` (e.g. `https://api.deepseek.com`), `FACTORY_MODEL`. Secret: `FACTORY_API_KEY`. Use a prepaid account with a spending limit. Without these variables the factory uses the free replay model.

### 4. Cloudflare Pages (site + intake)

1. Create a Pages project from the repository. Build command `npm run build`, output directory `dist`. The `functions/` folder is picked up automatically.
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

Before the talk: `npm run preflight`, enable the factory workflow, set `INTAKE_OPEN=1`.

After the talk: set `INTAKE_OPEN=0`, disable the factory workflow, revoke the intake's GitHub token and the model key.

Also recommended once a real model key exists: a prepaid model account with a small balance (it is the last spending limit), and a Cloudflare rate-limiting rule on `/api/peticion` (a few requests per minute per IP).

## License

Not decided yet.
