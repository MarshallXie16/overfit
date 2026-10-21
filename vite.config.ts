import { defineConfig } from 'vite';

// Absolute base URL for share-card meta tags (index.html %VITE_PUBLIC_URL%). Override per build:
//   VITE_PUBLIC_URL=https://your.host/path npm run build   (or set it in a gitignored .env)
process.env.VITE_PUBLIC_URL ??= 'https://marshallxie16.itch.io/overfit';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
