import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single self-contained HTML build (all JS/CSS/fonts inlined) for artifact / itch.io style hosting.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: 'dist-single',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5000,
  },
});
