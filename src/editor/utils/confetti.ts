/**
 * 换肤「撒盐」特效
 *
 * 与普通彩带 confetti 的区别（产品要求）：
 *   - 颗粒很小（2~4px），像盐粒而不是纸屑；
 *   - 数量克制（70 粒），不铺满全屏，只从画面上部中间 40% 宽度的窄带飘落；
 *   - 下落慢、带轻微重力与旋转，1.6 秒后开始渐隐，全程约 2.4 秒；
 *   - canvas 挂 fixed + pointer-events:none，结束后自动移除，不残留 DOM。
 */

let running = false

export function saltConfetti(colors: string[]): void {
  if (!colors || !colors.length || typeof window === 'undefined') return
  if (running) return // 防连点叠加
  running = true

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const W = window.innerWidth
  const H = window.innerHeight
  const cvs = document.createElement('canvas')
  cvs.width = W * dpr
  cvs.height = H * dpr
  cvs.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:300'
  document.body.appendChild(cvs)
  const ctx = cvs.getContext('2d')!
  ctx.scale(dpr, dpr)

  /* 盐粒：小、慢、窄带飘落 */
  const grains = Array.from({ length: 70 }, (_, i) => ({
    x: W * 0.3 + Math.random() * W * 0.4,          // 上部中间窄带
    y: -10 - Math.random() * H * 0.3,
    vx: (Math.random() - 0.5) * 0.9,               // 横向漂移很轻
    vy: 1.2 + Math.random() * 2.2,                 // 慢速下落
    s: 2 + Math.random() * 2,                      // 2~4px
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.18,
    color: colors[i % colors.length],
  }))

  const t0 = performance.now()
  function frame(now: number) {
    const el = now - t0
    ctx.clearRect(0, 0, W, H)
    let alive = false
    for (const g of grains) {
      g.x += g.vx
      g.y += g.vy
      g.vy += 0.02 // 轻微重力
      g.rot += g.vr
      const alpha = el > 1600 ? Math.max(0, 1 - (el - 1600) / 800) : 1
      if (alpha <= 0 || g.y > H + 20) continue
      alive = true
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(g.x, g.y)
      ctx.rotate(g.rot)
      ctx.fillStyle = g.color
      ctx.fillRect(-g.s / 2, -g.s / 2, g.s, g.s)
      ctx.restore()
    }
    if (alive && el < 2400) {
      requestAnimationFrame(frame)
    } else {
      cvs.parentNode?.removeChild(cvs)
      running = false
    }
  }
  requestAnimationFrame(frame)
}
