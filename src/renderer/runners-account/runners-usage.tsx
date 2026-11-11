// 사용 통계 동의 창과 설정 줄. 처음 켠 뒤 한 번 묻고, 설정에서 다시 바꾼다. 저장은 main/usage-stats.ts 가 맡는다.
import './runners-account.css'
import { RunnersMark } from './runners-account'
import { MenuSwitch } from './runners-menu'
import { USAGE_TEXT } from './runners-usage-text'

type Lang = keyof typeof USAGE_TEXT
type UsageKey = keyof (typeof USAGE_TEXT)['en']

function pickLang(tag: string): Lang {
  const codes = Object.keys(USAGE_TEXT) as Lang[]
  const exact = codes.find((code) => code.toLowerCase() === tag.toLowerCase())
  if (exact) {
    return exact
  }
  const language = tag.split(/[-_]/)[0].toLowerCase()
  if (language === 'zh') {
    return /-(hant|tw|hk|mo)\b/i.test(tag.replace(/_/g, '-')) ? 'zh-Hant' : 'zh-Hans'
  }
  return (codes as string[]).includes(language) ? (language as Lang) : 'en'
}

export function usageText(lang: string, key: UsageKey, app = ''): string {
  return USAGE_TEXT[pickLang(lang)][key].replace('{app}', app)
}

/** 처음 켠 뒤 한 번 묻는 창. 둘 중 하나를 눌러야 닫힌다. 고르지 않으면 꺼진 채로 다음에 다시 묻는다. */
export function UsageConsentSheet(props: {
  lang: string
  app: string
  onChoose: (granted: boolean) => void
}) {
  const text = (key: UsageKey) => usageText(props.lang, key, props.app)
  return (
    <div className="ra-cover">
      <div
        className="ra-sheet ra-usage-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={text('title')}
      >
        <RunnersMark />
        <div className="ra-title">{text('title')}</div>
        <div className="ra-hint ra-intro">{text('intro')}</div>
        <div className="ra-usage-list">
          <div>
            <div className="ra-usage-label">{text('sendsLabel')}</div>
            <div>{text('sends')}</div>
          </div>
          <div>
            <div className="ra-usage-label">{text('neverLabel')}</div>
            <div>{text('never')}</div>
          </div>
        </div>
        <div className="ra-hint">{text('change')}</div>
        <div className="ra-usage-actions">
          <button type="button" className="ra-usage-deny" onClick={() => props.onChoose(false)}>
            {text('deny')}
          </button>
          <button type="button" className="ra-submit" onClick={() => props.onChoose(true)}>
            {text('allow')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 설정 화면에서 다시 바꾸는 줄. */
export function UsageConsentSwitch(props: {
  lang: string
  granted: boolean
  onChange: (granted: boolean) => void
}) {
  return (
    <MenuSwitch
      label={usageText(props.lang, 'rowTitle')}
      checked={props.granted}
      onChange={props.onChange}
    />
  )
}
