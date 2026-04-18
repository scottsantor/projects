import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'build/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'https://linear-jira-sync.vibeplatstage.squarecdn.com',
        changeOrigin: true,
      },
    },
  },
})
