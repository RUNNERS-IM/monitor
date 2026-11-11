// 새 판을 설치할지 묻는 창. 그림과 동작은 kit 부품이다.
import { useTranslation } from 'react-i18next'
import { answerUpdate, fitHeight, onUpdateOffer, updateOffer } from './native'
import { useAppIcon } from './app-icon'
import './App.css'
import { RunnersUpdate } from './runners-account/runners-update'
import type { RunnersT } from './runners-account/runners-about'

export default function Update() {
  const { t } = useTranslation()
  const appIcon = useAppIcon()
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
