const STORAGE_KEY = 'qqr-theme'

export type Theme = 'light' | 'dark' | 'system'

export function initTheme() {
  const theme = getTheme()
  applyTheme(theme)
  // 监听系统偏好变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system')
  })
}

export function applyTheme(theme: Theme) {
  const isDark = theme === 'dark'
    || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
}

export function getTheme(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'system'
}

export function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}
