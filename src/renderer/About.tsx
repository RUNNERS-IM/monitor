// Monitor 의 About 창. 그림과 동작은 kit 부품이다. 운영체제 About 창에는 앱 카드를 넣을 수 없어 쓰지 않는다.
import { useTranslation } from 'react-i18next'
import { locale } from './i18n'
import { closeWindow, fitHeight, openExternal, version } from './native'
import appIcon from './assets/app-icon.png'
import './App.css'
import { RunnersAbout, type RunnersT } from './runners-account/runners-about'

const open = (url: string) => void openExternal(url)
// Why: 고지는 600 KB 나 되어 누를 때만 읽는다.
const loadNotices = () => import('../../THIRD_PARTY_NOTICES.md?raw').then((file) => file.default)
// Why: 개발 실행은 고지 창을 연 채로 시작해 찍을 수 있다(`VITE_MONITOR_EXPAND=notices`).
const startWithNotices = import.meta.env.DEV && import.meta.env.VITE_MONITOR_EXPAND === 'notices'

export default function About() {
  const { t } = useTranslation()
  return (
    <RunnersAbout
      appId="monitor"
      appName="Monitor"
      appIcon={appIcon}
      website="https://runners.im/monitor"
      github="https://github.com/RUNNERS-IM/monitor"
      locale={locale}
      t={t as RunnersT}
      version={version}
      openExternal={open}
      closeWindow={closeWindow}
      fitHeight={fitHeight}
      loadNotices={loadNotices}
      startWithNotices={startWithNotices}
    />
  )
}
