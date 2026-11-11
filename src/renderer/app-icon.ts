// 앱 안 화면(설정 › 정보, 숨기기 묻는 창, 새 판 창)의 앱 아이콘. 밝은 화면은 화이트 판, 어두운 화면은 블랙 판이다.
// Why: Dock 아이콘은 화이트 판 하나로 두고, 앱 안 그림만 화면 밝기를 따라간다(2026-11-11 앱 아이콘 1A 2B).
// kit 부품은 그림 주소 하나만 받으므로 밝기를 읽어 주소를 고르고, 시스템 밝기가 바뀌면 다시 고른다.
import { useEffect, useState } from 'react'
import light from './assets/app-icon.png'
import dark from './assets/app-icon-dark.png'

const DARK = '(prefers-color-scheme: dark)'

export function useAppIcon() {
  const [isDark, setDark] = useState(() => window.matchMedia(DARK).matches)
  useEffect(() => {
    const media = window.matchMedia(DARK)
    const change = () => setDark(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return isDark ? dark : light
}
