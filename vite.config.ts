import { defineConfig } from 'vite'

// Relative asset URLs let the game work from either a custom domain or the
// /<repository-name>/ path used by GitHub Pages project sites.
export default defineConfig({
  base: './',
  build: {
    // Older iPads can load the CSS but cannot parse newer syntax such as
    // optional chaining, leaving an otherwise empty blue screen.
    target: 'es2017',
  },
})
