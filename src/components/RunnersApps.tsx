// "RUNNERS 의 다른 앱" / "RUNNERS 의 서비스" cards, the same shape in Split, Prompt and Monitor
// (_docs/작업 가이드/공통.md, "계정 칸과 다른 앱 추천"). Markup and look follow Prompt's PromptRunnersApps.
import { t } from "../i18n";
import { pickText, type RunnersAppGroup } from "../runnersApps";
import "./RunnersApps.css";

export type RunnersAppsProps = {
  groups: RunnersAppGroup[];
  /** Screen language code (e.g. "ko", "de"); titles and descriptions fall back to English outside Korean. */
  locale: string;
  /** Called with an https url when "Get" is pressed; the app opens it in the default browser. */
  onOpen: (url: string) => void;
};

export function RunnersApps({ groups, locale, onOpen }: RunnersAppsProps) {
  if (groups.length === 0) return null;
  const get = t("about.get");
  return (
    <div className="runners-apps">
      {groups.map((group) => {
        const titleId = `runners-apps-${group.id}`;
        return (
          <section key={group.id} className="runners-apps-group" aria-labelledby={titleId}>
            <h3 id={titleId} className="runners-apps-title">
              {pickText(group.title, locale)}
            </h3>
            <ul className="runners-apps-card">
              {group.items.map((item) => (
                <li key={item.id} className="runners-apps-row">
                  {item.iconUrl ? (
                    <img className="runners-apps-icon" src={item.iconUrl} alt="" draggable={false} />
                  ) : (
                    // Why: a missing logo should not leave a hole, so the first letter stands in.
                    <span className="runners-apps-icon runners-apps-letter" aria-hidden>
                      {item.name.slice(0, 1)}
                    </span>
                  )}
                  <div className="runners-apps-text">
                    <div className="runners-apps-name">{item.name}</div>
                    <div className="runners-apps-desc">{pickText(item.desc, locale)}</div>
                  </div>
                  {/* Why: a row without a link has nothing to get yet, so it shows no button rather than a dead one. */}
                  {item.url && (
                    <button type="button" className="runners-apps-get" aria-label={`${get} ${item.name}`} onClick={() => onOpen(item.url)}>
                      {get}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
