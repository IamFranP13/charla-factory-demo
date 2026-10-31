# Local runner + load test

The factory pipeline runs on the maintainer's Linux PC (in parallel, seconds to start) instead of depending on GitHub Actions;
Actions stays as the fallback. A load test measures both modes with the replay provider before the talk.
Origin: comparison with ski043/marshal-factory (runner on the owner's machine). Commits go straight to `main`.

## Specs

- **S1** User (verbatim): "Quiero ver si su enfoque es mejor que el mio para lo que tenemos construido, porque es más fácil que alguien ponga tareas en linear que nuestro plan y así podemos ejecutar en nuestro pc en lugar depender tanto de github". Chosen: "Runner local + prueba de carga (recomendado)". The audience keeps the QR form; Linear is out of scope.
- **S2** Runner: `npm run runner -- [--paralelo N]` (default 6) is a long-running process on the PC. It polls (every few seconds, one API call) the open issues labelled `entrada` whose author is the repository owner and that the factory has not started (no `factory:state` marker and no `tarea/N` branch), and runs up to N of them at once. Each runs in its own throwaway worktree of `origin/main`, doing exactly what `.github/workflows/factory.yml` does: `node scripts/factory.mjs --issue N`; on `ok`, branch `tarea/N`, commit only the reported files, push and `gh pr create` with the App token ("Closes #N", label `perfil:<perfil>`), then `--issue N --pr M`; on anything but `ok`/`ignored`, close the issue "not planned" with the same comment as the workflow. Issues filed while the runner was stopped are picked up when it starts (backlog). Ctrl+C lets the running requests finish and starts no new one.
- **S3** One mode at a time: the runner refuses to start while the factory workflow is enabled (message tells how to disable it), and only one runner instance may run (lock). Fallback = stop the runner, `gh workflow enable factory.yml`.
- **S4** Secrets stay on the PC, outside the repos, mode 600, under `~/.config/charla-factory-demo/` (App id, App private key, optional model settings and key). The runner mints App installation tokens itself (JWT, no new dependency) and checks at start that the installation grants what it needs (contents, pull requests, issues write); it fails closed with a clear message otherwise. The `factory.mjs` child gets only what the workflow gives it (model variables, `GH_TOKEN`, `GITHUB_REPOSITORY`, browser path); no token is written to any `.git/config`; the model's code still runs only in the existing sandbox.
- **S5** Trust: what reads factory comments (`lib/numbers.js`, and anything else that trusts `github-actions[bot]`) also accepts the App's bot login from `policy/risk.yaml` (`factory:`), so local runs count in the closing numbers and the board; nobody else's marker counts.
- **S6** Load test: `npm run carga -- --n N [--json]` files N issues in the intake's exact format (titles, labels, one-line JSON body, profiles in equal parts) taken from the replay battery's requests, with the owner's `gh`, then follows them until each is final or a timeout, and reports per request and in aggregate (median, p90, max): issue → factory started, → PR opened, → merged, → deployed (`/deploy.json` commit contains the merge), plus final status counts. It needs the factory running (runner or workflow) and prints the reminder to `reset-demo` afterwards. The timing maths is a pure tested module.
- **S7** Docs: README (how to set up and run the runner, modes and fallback, load test), help text of both scripts.

## Tasks

| ID | Specs | Route | Commit |
|----|-------|-------|--------|
| T1 | S2-S5, S7 | worker (background) | |
| T2 | S6, S7 (script help only) | worker (background) | |
| T3 | S2-S6 | parent: independent verify (Risk: items 2 and 4), first real run with the replay, load test in both modes | |

## Log

- **L1** User: "Quiero ver si su enfoque es mejor que el mio para lo que tenemos construido, porque es más fácil que alguien ponga tareas en linear que nuestro plan y así podemos ejecutar en nuestro pc en lugar depender tanto de github" → "Runner local + prueba de carga (recomendado)".
- **L2** Evidence: `scripts/factory.mjs` already runs the whole pipeline locally; Actions only triggers it. The queue has three parts (Actions start, PR CI, Cloudflare deploy); the runner removes only the first. marshal-factory caps at 4 jobs per machine and has no spending cap.
