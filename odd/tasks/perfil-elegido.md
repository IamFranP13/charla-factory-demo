# Profile chosen by the requester

The audience chooses the profile (Marketing, Producto, Negocio) they ask from, on a page of its own (`/pide/`); each
profile may ask only for some kinds. The profile only restricts, never grants: the risk gate still decides by the diff.
Branch `feat/perfil-elegido`, tests first, one commit per task.

## Specs

- **S1** "quiero cambiar que los perfiles se asignen aleatoriamente en cada petición, quiero darles a elegir que puedan elegir la petición desde que perfil la mandan". The server takes the profile the requester chose (one of `marketing`, `producto`, `negocio`); a missing or unknown profile is refused and nothing is filed.
- **S2** "habría que separar en la web donde mandan lo que quieren hacer y que ahí elijan el perfil" → "Página propia /pide/": a page only for asking, where the requester first picks the profile (showing what each one may ask for) and then writes the request; `/factory/` keeps only the board, and every "Pedir un cambio" link goes to `/pide/`.
- **S3** "tenemos que pensar que va a poder hacer cada perfil" → "Por áreas, y 'bug' para todos": Marketing → campana · estilo · bug; Producto → producto · destino · feature · bug; Negocio → precios · descuentos · transporte · cambio · bug.
- **S4** "Se rechaza con motivo": a request whose change is outside its profile ends rejected (in "Rechazadas") with a reason such as «Marketing no puede cambiar precios: pídelo como Negocio», checked by code.

## Tasks

| ID | Specs | What | Route | Commit |
|----|-------|------|-------|--------|
| T1 | S1, S3 | `lib/perfiles.js` (the profiles, their kinds, the kinds of a change from its paths); intake takes the chosen profile and refuses a missing or unknown one | inline | |
| T2 | S3, S4 | Factory: the agent's prompt names the kinds of its profile; after the agent, the kinds of the diff are checked against the profile in code and a change outside it is rejected with the reason | inline | |
| T3 | S2 | `/pide/` page (profile choice + form + "Tus peticiones"); `/factory/` board only; links to `/pide/`; styles in both stylesheets; docs | inline | |

## Log

- **L1** User, verbatim: "vale, entonces nuestra factory ya funciona como quiero, ahora quiero mejorarla un poco pero primero quiero cambiar que los perfiles se asignen aleatoriamente en cada petición, quiero darles a elegir que puedan elegir la petición desde que perfil la mandan y para ello habría que separar en la web donde mandan lo que quieren hacer y que ahí elijan el perfil, pero tenemos que pensar que va a poder hacer cada perfil"
- **L2** Answers: profiles "Por áreas, y 'bug' para todos (Recomendado)"; outside the profile "Se rechaza con motivo (Recomendado)"; web "Página propia /pide/ (Recomendado)". Write access to this repository granted for the session.
- **L3** Parent decisions. (a) A chosen profile proves nothing (anyone can pick Negocio), so it only restricts: `policy/risk.yaml` still decides by the diff, never by who asked. (b) The agent does not declare a kind (resultado.json has only `estado` and `resumen`, S9 of `fabrica-agentes.md`), so the kinds of a change are derived from its paths in code, like the gate. `src/features/<id>/index.js` added → `feature`, changed → `bug`; `src/domain/**` → `bug` or `cambio` (allowed when the profile has either). (c) Files outside every kind's surface (platform, pages…) are not limited by the profile: the gate sends them to a person, as today.
