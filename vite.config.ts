import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { createServer as createViteRuntimeServer, defineConfig, type Plugin } from 'vite'

type ApiHandlerFn = (req: IncomingMessage, res: ServerResponse) => Promise<void>

function lsWayArcadeApiPlugin(): Plugin {
  let previewHandlerPromise: Promise<ApiHandlerFn> | null = null

  return {
    name: 'ls-way-arcade-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          next()
          return
        }
        void server
          .ssrLoadModule('/api/index.ts')
          .then((mod) => (mod.default as ApiHandlerFn)(req, res))
          .catch(next)
      })
    },
    configurePreviewServer(previewServer) {
      previewServer.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          next()
          return
        }
        if (!previewHandlerPromise) {
          previewHandlerPromise = createViteRuntimeServer({
            server: { middlewareMode: true },
            appType: 'custom',
          }).then(async (viteRunner) => {
            const mod = await viteRunner.ssrLoadModule('/api/index.ts')
            return mod.default as ApiHandlerFn
          })
        }
        void previewHandlerPromise.then((fn) => fn(req, res)).catch(next)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), lsWayArcadeApiPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) {
            return 'vendor-three'
          }
          return undefined
        },
      },
    },
  },
})
