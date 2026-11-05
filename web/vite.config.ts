import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En dev, les appels /api partent vers le serveur Node.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
