# charla-factory-demo

A tiny AI factory, built for the talk *Vibe Engineering a escala de empresa*.

The audience scans a QR code and asks for a change to this website. A chain of cheap agents builds it. A **risk gate written in code, not in a prompt** decides whether the change goes straight to production or waits for a human.

The whole platform is about a thousand lines of plain JavaScript and three workflows. That is the point of the talk: **an AI factory is not an AI problem, it is a platform problem.**

## How it works

```
QR → form (site/) → Pages Function (functions/api/peticion.js) → GitHub issue labelled "entrada"
                                                                        ↓
              factory.yml: Spec writer → Builder → reviewers (one loop back) → pull request
              every station comments on the issue: the issue is the audit trail
                                                                        ↓
              gate.yml: scripts/gate.mjs reads policy/risk.yaml and the PR's changed files
                    ↓                                               ↓
            low risk → auto-merge                      high risk → blocked until an approver approves
                    ↓
            Cloudflare Pages deploys main
```

| Piece | Where | What it shows |
|-------|-------|---------------|
| Profiles | `factory/profiles.yaml` | Marketing (wall cards), Producto (sections), Negocio (figures and config). Each one may only write in its folders. |
| Stations | `lib/factory.js`, `factory/prompts/` | Models only fill in content. Code chooses paths, validates every file (`lib/schemas.js`) and keeps score. |
| Risk gate | `policy/risk.yaml`, `lib/policy.js`, `scripts/gate.mjs` | Decides by **what the diff touches**, never by who asked. Fails closed. Approvals count only on the current head. |
| Models | `lib/providers.js` | `replay` (deterministic fake model, free, offline) or any OpenAI-compatible API. Reviewers can use another model. |
| Intake | `lib/intake.js` | Turnstile, a task cap and a kill switch. Input is data, never instructions. |
| Shared rules | `AGENTS.md` | The same rules for the factory agents and for a local harness (Pi, Claude Code, OpenCode…). |

## Run it locally (free, offline)

```bash
npm install
npm test                       # everything, including workflow structure checks
npm run simulate               # the whole pipeline on a 32-request battery, replay model
npm run factory -- --profile marketing --request "Una tarjeta verde que diga «Hola desde la fila 3»" --id 1
npm run gate -- content/muro/tarea-1.json config/entradas.json data/cifras.json
npm run build                  # → dist/
```

With a real model:

```bash
FACTORY_PROVIDER=openai FACTORY_API_URL=https://api.deepseek.com FACTORY_MODEL=<model id> FACTORY_API_KEY=<key> \
  npm run simulate
```

## The demo twist (on purpose)

`policy/risk.yaml` protects `data/` but forgets `config/`, and its default is `auto`. A Negocio request such as *"baja el precio de la entrada a 0 euros"* edits `config/entradas.json`, passes every reviewer and **merges without a human**. The issue's trail shows why: the gate took the `default` rule.

The fix is one line, no prompt touched:

```diff
-default: auto
+default: human
```

Run `npm run preflight` before the talk: it checks the hole is open, `factory` is set and the price is back at the seed value.

Re-run the request **asking for a different price** (e.g. *"Sube el precio de la entrada a 50 euros"*): asking for the value that is already there ends as `unchanged` and opens no PR. It is now blocked, waiting for a person. *"No he arreglado esta tarea. He arreglado las cien siguientes."*

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

After an approver approves a blocked PR, the gate re-runs on the review event (same-repository PRs only; for a fork PR, re-run the failed `risk-gate` job by hand after approving) and passes, but it does not merge: a human merges. When the gate does merge (factory PRs on the auto route), it pins the commit it judged, so a later push cancels the merge.

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
| `GITHUB_TOKEN` | Fine-grained token, this repository only, **Issues: read and write**, nothing else |
| `GITHUB_REPO` | `owner/repo` |
| `INTAKE_OPEN` | `1` to accept requests, anything else closes the form (kill switch) |
| `INTAKE_MAX_TASKS` | Task cap, default `15`, **max `100`** (higher values are clamped; the check is not atomic, so a burst can overshoot slightly) |

Issues are created with your token, so the factory only accepts issues authored by the repository owner.

## On the day

```bash
GITHUB_REPOSITORY=owner/repo FACTORY_PRICE_IN=<€/M> FACTORY_PRICE_OUT=<€/M> npm run numbers
```

prints the closing numbers: requests, in production, waiting for a person, rejected, failed, tokens, cost and mean time.

Kill switch: set `INTAKE_OPEN` to `0` in Cloudflare and redeploy.

## License

Not decided yet.
