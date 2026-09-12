import { defineConfig } from 'vite'

// Relative asset URLs let the game work from either a custom domain or the
// /<repository-name>/ path used by GitHub Pages project sites.
export default defineConfig({
  base: './',
})
