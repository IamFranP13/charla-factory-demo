import { handleAccess } from '../../lib/intake.js'

// Cloudflare Pages Function: GET /api/acceso?clave=<key> (rehearsal pass) and GET /api/acceso?salir
export const onRequestGet = ({ request, env }) => handleAccess(request, env)
