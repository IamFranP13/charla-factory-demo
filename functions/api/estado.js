import { handleEstado } from '../../lib/estado.js'

// Cloudflare Pages Function: GET /api/estado[?tarea=N]
export const onRequestGet = ({ request, env }) => handleEstado(request, env)
