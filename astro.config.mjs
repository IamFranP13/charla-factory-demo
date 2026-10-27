import { defineConfig } from 'astro/config'

// Static output to dist/: Cloudflare Pages runs `npm run build` and serves dist/ next to functions/.
export default defineConfig({
  output: 'static',
  outDir: 'dist',
  devToolbar: { enabled: false },
})
