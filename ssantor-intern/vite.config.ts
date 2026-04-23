import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function getAppDisplayName(): string {
  try {
    const manifest = parse(readFileSync('app.yaml', 'utf-8'))
    return manifest?.display_name || manifest?.name || ''
  } catch {
    return ''
  }
}

function appTitlePlugin(): Plugin {
  const title = getAppDisplayName()
  return {
    name: 'app-title-from-yaml',
    transformIndexHtml(html: string) {
      if (!title) return html
      const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return html.replace(/<title>[^<]*<\/title>/, `<title>${escaped}</title>`)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), appTitlePlugin()],
  define: {
    'import.meta.env.VITE_APP_DISPLAY_NAME': JSON.stringify(getAppDisplayName()),
  },
  build: {
    outDir: 'build/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'https://ssantor-intern.vibeplatstage.squarecdn.com',
        changeOrigin: true,
      },
    },
  },
})
