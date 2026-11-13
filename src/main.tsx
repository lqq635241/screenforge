import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './editor/App'
import './index.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

/**
 * 移除 index.html 里的骨架屏。
 *
 * 为什么放在这里而不是让 React 覆盖：骨架屏位于 #root 之外，
 * 由浏览器在 JS 下载/执行前就渲染出来（FCP 从 3.8s 提前到 ~0.3s），
 * React 挂载完成后再淡出，避免出现"骨架和真实界面同时存在"的中间态。
 *
 * 用双 rAF 等到 React 首帧真正绘制后再开始淡出；另外设一个 3s 上限，
 * 防止极端情况下（如渲染异常）骨架一直挡着界面。
 */
function dismissBoot(): void {
  const boot = document.getElementById('boot')
  if (!boot) return
  let done = false
  const hide = () => {
    if (done) return
    done = true
    boot.classList.add('hide')
    window.setTimeout(() => boot.remove(), 320)
  }
  requestAnimationFrame(() => requestAnimationFrame(hide))
  window.setTimeout(hide, 3000)
}

if (document.getElementById('boot')) dismissBoot()
