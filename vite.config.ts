import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 部署基础路径。
 * - 本地开发 / 根域名部署：默认 '/'
 * - GitHub Pages 项目页（部署在 https://<user>.github.io/<仓库>/）：CI 中通过
 *   SF_BASE=/<仓库名>/ 注入，避免资源 404。见 .github/workflows/deploy.yml
 */
const base = process.env.SF_BASE || '/'

// 编辑器本身是一个 Vite + React 应用
export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 2000 },
})
