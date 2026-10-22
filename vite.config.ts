import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** replace the *.workers.dev wildcard in the CSP with the exact explain-worker origin */
const pinCsp = (explainUrl?: string): Plugin => ({
  name: 'pin-csp',
  closeBundle() {
    const f = 'dist/.ic-assets.json5';
    if (!existsSync(f)) return;
    const origin = explainUrl ? new URL(explainUrl).origin : '';
    writeFileSync(f, readFileSync(f, 'utf8').replace('https://*.workers.dev', origin));
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), tailwindcss(), pinCsp(env.VITE_EXPLAIN_URL)],
    build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  };
});
