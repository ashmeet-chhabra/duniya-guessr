import { defineConfig, createLogger } from 'vite'
import react from '@vitejs/plugin-react'

const logger = createLogger()

export default defineConfig({
  customLogger: {
    ...logger,
    error: (msg, options) => {
      if (msg.includes('http proxy error') && options?.error?.code === 'ECONNREFUSED') return
      logger.error(msg, options)
    }
  },
  cacheDir: '.vite-cache',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') return
            console.error('ws proxy error:', err)
          })
        },
      },
    },
  },
})
