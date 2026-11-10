import { useEffect } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/context/theme-provider'
import './theme-switch.css'

export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  /* Update theme-color meta tag
   * when theme is updated */
  useEffect(() => {
    const themeColor = isDark ? '#020817' : '#fff'
    const metaThemeColor = document.querySelector("meta[name='theme-color']")
    if (metaThemeColor) metaThemeColor.setAttribute('content', themeColor)
  }, [isDark])

  return (
    <label className='ui-switch'>
      <input
        type='checkbox'
        role='switch'
        aria-label='Dark mode'
        checked={isDark}
        onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')}
      />
      <div className='slider'>
        <div className='circle'>
          {isDark ? (
            <Moon size={20} aria-hidden='true' />
          ) : (
            <Sun size={20} aria-hidden='true' />
          )}
        </div>
      </div>
    </label>
  )
}
