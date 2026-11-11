// 「RUNNERS의 다른 앱」 · 「RUNNERS의 서비스」 카드. 모든 앱이 같은 모양이다.
import type { RunnersAppGroup } from './runners-apps-data'
import { pickName, pickText } from './runners-apps-data'
import './runners-apps.css'

export type RunnersAppsProps = {
  groups: RunnersAppGroup[]
  /** 화면 언어 코드. ko · ar 말고는 영어를 읽는다. */
  locale: string
  /** 「받기」 단추의 말. */
  getLabel: string
  /** https 주소를 기본 브라우저로 연다. */
  onOpen: (url: string) => void
}

export function RunnersApps({ groups, locale, getLabel, onOpen }: RunnersAppsProps) {
  if (groups.length === 0) {
    return null
  }
  return (
    <div className="runners-apps">
      {groups.map((group) => {
        const titleId = `runners-apps-${group.id}`
        return (
          <section key={group.id} className="runners-apps-group" aria-labelledby={titleId}>
            <h3 id={titleId} className="runners-apps-title">
              {pickText(group.title, locale)}
            </h3>
            <ul className="runners-apps-card">
              {group.items.map((item) => (
                <li key={item.id} className="runners-apps-row">
                  {item.iconUrl ? (
                    // 어두운 화면에서는 블랙 판으로 바뀐다. 시스템 밝기를 바꾸면 창을 다시 열지 않아도 따라간다.
                    <picture>
                      {item.iconDarkUrl && (
                        <source media="(prefers-color-scheme: dark)" srcSet={item.iconDarkUrl} />
                      )}
                      <img
                        className="runners-apps-icon"
                        src={item.iconUrl}
                        alt=""
                        draggable={false}
                      />
                    </picture>
                  ) : (
                    // 그림이 없어도 구멍이 나지 않게 첫 글자를 그린다.
                    <span className="runners-apps-icon runners-apps-letter" aria-hidden>
                      {pickName(item, locale).slice(0, 1)}
                    </span>
                  )}
                  <div className="runners-apps-text">
                    <div className="runners-apps-name">{pickName(item, locale)}</div>
                    <div className="runners-apps-desc">{pickText(item.desc, locale)}</div>
                  </div>
                  {/* 받을 곳이 없는 줄에는 죽은 단추를 두지 않는다. */}
                  {item.url && (
                    <button
                      type="button"
                      className="runners-apps-get"
                      aria-label={`${getLabel} ${pickName(item, locale)}`}
                      onClick={() => onOpen(item.url)}
                    >
                      {getLabel}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
