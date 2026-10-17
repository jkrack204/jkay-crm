import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the API runs on :3000 and Vite proxies /api to it, so the browser
// always talks to one origin — same as production (one Railway service).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
