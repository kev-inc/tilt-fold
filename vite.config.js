import { defineConfig } from 'vite';

export default defineConfig({
  // Vercel serves at domain root (tilt-fold.vercel.app).
  // For GitHub project Pages, set VITE_BASE=/tilt-fold/ at build time.
  base: process.env.VITE_BASE || '/',
  server: {
    host: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
});
