import { defineConfig } from 'vite';

export default defineConfig({
  base: '/tilt-fold/',
  server: {
    host: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
});
