import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Demo build: bundles the whole app — JS, CSS, fonts — into ONE
 * self-contained index.html. The result runs from anywhere: double-
 * clicked from a USB stick, attached to an e-mail, or dropped into a
 * chat. No server, no internet, no install.
 *
 *   npm run build:demo   ->  dist-demo/index.html
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: 'dist-demo',
  },
});
