/**
 * 浏览器下载工具 —— 所有导出（HTML / 工程 zip / schema json）共用一份实现。
 * 放在独立模块里是为了避免各导出模块各写一遍 createObjectURL + <a> 的样板。
 */

/** 触发浏览器下载 Blob */
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
