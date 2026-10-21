import { defineConfig } from 'vite';

// Absolute base URL for share-card meta tags (index.html %VITE_PUBLIC_URL%). Override per build:
//   VITE_PUBLIC_URL=https://your.host/path npm run build   (or set it in a gitignored .env)
process.env.VITE_PUBLIC_URL ??= 'https://marshallxie16.itch.io/overfit';
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
