# A descriptive factory issue

The GitHub issue of a request reads well for a person: what was asked, by which profile, from where, and, when the task
ends, a comment with the result. The machine-read parts (request block, state marker) stay where the code looks for them
and cannot be forged by the request text. Branch `feat/issue-descriptiva`, tests first.

## Specs

- **S1** "la issue en github tienen que ser más descriptiva" → "Cuerpo legible + comentario final": when the issue is created, its body shows the request (quoted, readable), the profile and what it may ask for, and the real origin (web form or a maintainer test); today it only says "Petición desde la web." (even for tests) and a JSON block.
- **S2** When the task ends, one comment with the result: deployed/merged with its PR and route, rejected or failed with the reason, or waiting for a person (with the PR). One comment per outcome, never repeated when the same step runs again.
- **S3** (parent, security) The request text is untrusted: in the visible body and comments it can neither forge the request block (` ```json `) nor a state or trace marker, nor mention people (`@`), link, embed images or HTML. `requestOf`, `parseIssueBody`, `parseState` keep reading the factory's own block and marker. Existing issues (old body format) keep working.

## Tasks

| ID | Specs | What | Route | Commit |
|----|-------|------|-------|--------|
| T1 | S1, S3 | `issueFor` writes the readable body (escaped request, profile + kinds, origin) above a folded machine block; readers unchanged and pinned against forgeries | worker | see L4 |
| T2 | S2, S3 | Final comment at each end: factory (rejected, failed, approver refusal, re-check failure, no change), gate (waiting for a person; merged; closed unmerged); escaped; once per outcome | worker + parent fixes | see L4 |
| T3 | S1-S3 | Independent verify (Risk item 2: guards), local check, commit | parent + verify | see L4 |

## Log

- **L1** User, verbatim: "no, está bien pero la issue en github tienen que ser más descriptiva". Answer: "Cuerpo legible + comentario final (Recomendado)" (body at creation: the request quoted, profile and what it may ask for, real origin; a comment at the end with the result).
- **L2** Parent findings: `requestOf` (lib/fabrica.js) and `requestEnd` (lib/estado.js) take the FIRST ```json block; `parseState` takes the LAST state marker below it; `replaceState`/`replaceTrace` keep everything above the block verbatim. So the visible copy of the request goes ABOVE the block and is HTML-escaped (no backtick, `<`, `>`, `&`, `@`, newlines as `<br>`), so it can contain neither a block nor a marker. No absolute site URL is known to the code, so no tracking link (not requested in S1's final form). The factory and the proxy were stopped after the 4-task run (#137 and #138 deployed, #139 and #140 rejected).
- **L3** Worker T1+T2: RED (old issueFor showed the raw request; gate 3 and factory 5 new tests failed), GREEN npm test 657/0. gate.yml unchanged (risk-gate and mark-closed already have `issues: write`).
- **L4** Independent verify: S1 pass; S2 fail (an unmerged close before the gate passed commented again on every re-run); S3 body pass, comments fail (`www.` autolinks). Parent checked GitHub's own renderer (`gh api markdown`, read-only): entities are NOT enough, `&#64;user` and `&#35;137` still become a mention and an issue link, inside `<blockquote>` too, and emails autolink. Fixes: `escapar` puts U+2060 (word joiner) after `@`, `#` and `www` (before the entities), `Object.hasOwn` for the origin; `commentIssue` (gate) skips a text already on the issue, so a re-run never repeats a comment while "changes requested, then closed" still gets its 🚫. Verifier's regression tests added. Real render of a hostile request: 0 links, images, mentions, issue links in body and comment. npm test 660/0 (2 skipped), build ok. One commit for T1-T3 on feat/issue-descriptiva.
