// 새 판을 설치할지 묻는 창. 그림과 동작은 kit 부품이다.
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { locale } from './i18n'
import { answerUpdate, fitHeight, onUpdateOffer, updateOffer } from './native'
import appIcon from './assets/app-icon.png'
import './App.css'
import { RunnersUpdate } from './runners-account/runners-update'
import type { RunnersT } from './runners-account/runners-about'

export default function Update() {
  const { t } = useTranslation()
  // Why: 릴리스 노트는 한국어 · 영어뿐이라 한국어가 아닌 화면에는 영어로 나온다. 영어 글로 표시해야 아랍어 화면에서도 마침표가 문장 끝에 온다. 칸은 kit 부품 안에 있고 노트가 도착한 뒤에 생기므로 생길 때 표시한다.
  useEffect(() => {
    if (locale === 'ko') {
      return
    }
    const watch = new MutationObserver(() => {
      const list = document.querySelector('.update-list')
      list?.setAttribute('dir', 'ltr')
      list?.setAttribute('lang', 'en')
    })
    watch.observe(document.body, { childList: true, subtree: true })
    return () => watch.disconnect()
  }, [])
  return (
    <RunnersUpdate
      appIcon={appIcon}
      t={t as RunnersT}
      offer={updateOffer}
      onOffer={onUpdateOffer}
      answer={answerUpdate}
      fitHeight={fitHeight}
    />
  )
}
