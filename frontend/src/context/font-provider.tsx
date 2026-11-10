import { createContext, useContext, useEffect, useState } from 'react'
import { fonts } from '@/config/fonts'
import { getCookie, setCookie, removeCookie } from '@/lib/cookies'

type Font = (typeof fonts)[number]

const FONT_COOKIE_NAME = 'font'
const FONT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

const FONT_STACKS: Record<Font, string> = {
  'IBM Plex Sans': '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
  'IBM Plex Mono': '"IBM Plex Mono", ui-monospace, monospace',
  'Saira Semi Condensed':
    '"Saira Semi Condensed", ui-sans-serif, system-ui, sans-serif',
}

type FontContextType = {
  font: Font
  setFont: (font: Font) => void
  resetFont: () => void
}

const FontContext = createContext<FontContextType | null>(null)

export function FontProvider({ children }: { children: React.ReactNode }) {
  const [font, _setFont] = useState<Font>(() => {
    let savedFont: string | undefined
    try {
      const raw = getCookie(FONT_COOKIE_NAME)
      savedFont = raw ? decodeURIComponent(raw) : undefined
    } catch {
      savedFont = undefined
    }
    return fonts.includes(savedFont as Font) ? (savedFont as Font) : fonts[0]
  })

  useEffect(() => {
    document.documentElement.style.setProperty('--font-sans', FONT_STACKS[font])
  }, [font])

  const setFont = (font: Font) => {
    try {
      setCookie(FONT_COOKIE_NAME, encodeURIComponent(font), FONT_COOKIE_MAX_AGE)
    } catch {
      // persistence unavailable; keep in-memory choice
    }
    _setFont(font)
  }

  const resetFont = () => {
    try {
      removeCookie(FONT_COOKIE_NAME)
    } catch {
      // persistence unavailable; keep in-memory reset
    }
    _setFont(fonts[0])
  }

  return (
    <FontContext value={{ font, setFont, resetFont }}>{children}</FontContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useFont = () => {
  const context = useContext(FontContext)
  if (!context) {
    throw new Error('useFont must be used within a FontProvider')
  }
  return context
}
