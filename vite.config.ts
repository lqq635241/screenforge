import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 部署基础路径。
 * - 本地开发 / 根域名部署：默认 '/'
 * - GitHub Pages 项目页（部署在 https://<user>.github.io/<仓库>/）：CI 中通过
 *   SF_BASE=/<仓库名>/ 注入，避免资源 404。见 .github/workflows/deploy.yml
 */
const base = process.env.SF_BASE || '/'

/**
 * 构建后把外部 CSS 内联进 index.html。
 *
 * 为什么做：Lighthouse 报「渲染阻塞请求」——原本要先下载 6.4KB 的
 * /assets/index-xxx.css 才能首绘，慢网下多一个 RTT（300ms+）。
 * 编辑器样式总共几 KB，内联比外链划算；顺带删掉已内联的 css 文件，
 * 避免产物里留一份没人引用的死文件。
 */
function inlineCss(): Plugin {
  return {
    name: 'sf-inline-css',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      const dist = 'dist'
      const htmlPath = join(dist, 'index.html')
      if (!existsSync(htmlPath)) return

      let html = readFileSync(htmlPath, 'utf8')
      html = html.replace(
        /<link[^>]*rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/g,
        (tag, href: string) => {
          // href 形如 /screenforge/assets/index-xxx.css，去掉 base 前缀还原成 dist 内相对路径
          const rel = (base !== '/' && href.startsWith(base) ? href.slice(base.length) : href).replace(/^\//, '')
          const file = join(dist, rel)
          if (!existsSync(file)) return tag
          const css = readFileSync(file, 'utf8')
          unlinkSync(file)
          return `<style>${css}</style>`
        },
      )
      writeFileSync(htmlPath, html)
    },
  }
}

// 编辑器本身是一个 Vite + React 应用
export default defineConfig({
  base,
  plugins: [react(), inlineCss()],

  /**
   * 首开性能：
   * - include 把 echarts/jszip/react 预声明为依赖，dev server 启动时立即预构建，
   *   否则首次打开页面时才发现依赖 → 现场预构建 → 触发整页 reload（实测冷启动 5s+ 且打开两次）。
   * - warmup 在服务启动后台预热核心源码模块的转换，首次请求无需现场 transform。
   */
  optimizeDeps: { include: ['echarts', 'jszip', 'react', 'react-dom', 'react-dom/client'] },
  server: {
    port: 5173,
    warmup: { clientFiles: ['./src/core/**/*.ts', './src/editor/**/*.tsx', './src/index.css'] },
  },

  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // echarts 拆独立 vendor chunk：版本不变时浏览器可长期缓存，
        // 业务代码更新后用户无需重新下载 ~1MB 的图表库
        manualChunks: { echarts: ['echarts'] },
      },
    },
  },
})
