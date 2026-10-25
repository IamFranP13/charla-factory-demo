import { handleIntake } from '../../lib/intake.js'

// Cloudflare Pages Function: POST /api/peticion
export const onRequestPost = ({ request, env }) => handleIntake(request, env)
