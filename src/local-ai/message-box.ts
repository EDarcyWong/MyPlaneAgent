import { ElMessageBox, type ElMessageBoxOptions } from 'element-plus'
import type { CSSProperties } from 'vue'
import './message-box.css'

function appearance(title: string, options: ElMessageBoxOptions, prompt: boolean): ElMessageBoxOptions {
 const focused = document.activeElement?.closest<HTMLElement>('[data-theme][data-style]')
 const source = focused || [...document.querySelectorAll<HTMLElement>('[data-theme][data-style]')].find(node => node.getClientRects().length)
 const theme = source && getComputedStyle(source)
 const customStyle: CSSProperties = {}
 for (const name of ['bg','panel','muted','border','text','dim','accent','on-accent','accent-soft','danger']) {
  const value = theme?.getPropertyValue('--s-' + name).trim()
  if (value) customStyle[`--s-${name}`] = value
 }
 if (theme) customStyle.colorScheme = theme.colorScheme
 const destructive = !prompt && /删除|清空|放弃/.test(title)
 return {
  confirmButtonText: prompt ? (/新建|创建/.test(title) ? '创建' : '保存') : '确认', cancelButtonText: '取消',
  ...options,
  center: true, showClose: false,
  customClass: ['app-message-box', destructive ? 'app-message-box--danger' : '', options.customClass].filter(Boolean).join(' '),
  modalClass: ['app-message-box-overlay', options.modalClass].filter(Boolean).join(' '),
  customStyle: { ...customStyle, ...options.customStyle },
 }
}

/** Shared appearance; validation, cancellation and approval handling stay with callers. */
export const AppMessageBox = {
 confirm(message: ElMessageBoxOptions['message'], title: string, options: ElMessageBoxOptions = {}) {
  return ElMessageBox.confirm(message, title, appearance(title, options, false))
 },
 prompt(message: ElMessageBoxOptions['message'], title: string, options: ElMessageBoxOptions = {}) {
  return ElMessageBox.prompt(message, title, appearance(title, options, true))
 },
}
