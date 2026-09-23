import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// This project keeps JSX in .js files (a Create React App carry-over), so the
// React plugin and esbuild are told to treat .js as JSX.
export default defineConfig({
  plugins: [react({ include: /\.(js|jsx)$/ })],
  // Keep the existing REACT_APP_ env var prefix so .env files keep working.
  envPrefix: 'REACT_APP_',
  server: { port: 3000, open: false },
  build: { outDir: 'build' },
  esbuild: { loader: 'jsx', include: /src\/.*\.js$/, exclude: [] },
  optimizeDeps: {
    esbuildOptions: { loader: { '.js': 'jsx' } },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    css: false,
    // Run in the business's own time zone. In UTC, date bugs that only show up
    // west of Greenwich (a start date displaying a day early) stay hidden.
    env: { TZ: 'America/Halifax' },
  },
})
