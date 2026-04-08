import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'serve-images-dir',
      configureServer(server) {
        server.middlewares.use('/cards', (req, res, next) => {
          const filename = decodeURIComponent(req.url ?? '').replace(/^\//, '')
          const filePath = path.resolve(__dirname, '../Images', filename)
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filename).toLowerCase()
            const contentType = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png'
            res.setHeader('Content-Type', contentType)
            fs.createReadStream(filePath).pipe(res)
          } else {
            next()
          }
        })
      },
    },
  ],
  server: {
    port: 5200,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})
