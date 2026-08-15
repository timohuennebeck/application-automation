import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  // Relative paths so the built renderer loads over file:// in the packaged app.
  base: './',
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            // The Agent SDK spawns its bundled CLI, so it must stay a runtime
            // require. NOTE: rolldownOptions, not rollupOptions — Vite 8 runs
            // on rolldown and vite-plugin-electron silently drops the latter.
            rolldownOptions: { external: ['@anthropic-ai/claude-agent-sdk'] },
          },
        },
      },
      preload: { input: 'electron/preload.ts' },
    }),
  ],
});
