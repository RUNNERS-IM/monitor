// The "More apps from RUNNERS" / "Services from RUNNERS" list shown in the About window.
// The list is a copy of ~/git/runners/_docs/작업 가이드/runners-apps.json (re-copy with scripts/sync-runners-apps.sh),
// bundled into the app so the cards show without a network. Icons are 64px PNGs in assets/runners-apps/,
// named after the json "icon" field.
import source from "./runners-apps.json";

/** The json only has Korean and English; every other screen language reads English. */
export type RunnersText = { ko?: string; en?: string };

export type RunnersAppItem = {
  id: string;
  name: string;
  /** Bundled icon URL; empty when no file with that name is bundled, and the card shows the first letter instead. */
  iconUrl: string;
  desc: RunnersText;
  /** Empty when there is nothing to download yet; the card then hides its "Get" button. */
  url: string;
};

export type RunnersAppGroup = { id: string; title: RunnersText; items: RunnersAppItem[] };

const ICONS = import.meta.glob<string>("./assets/runners-apps/*.png", { eager: true, query: "?url", import: "default" });

/** Only https links are opened, so a typo or a local path in the json cannot launch anything else. */
export function isSafeUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Card groups without the app that shows them; groups left empty are dropped. */
export function loadRunnersAppGroups(selfId: string): RunnersAppGroup[] {
  return source.groups
    .map((group) => ({
      id: group.id,
      title: group.title,
      items: group.items
        .filter((item) => item.id !== selfId)
        .map((item) => ({
          id: item.id,
          name: item.name,
          iconUrl: ICONS[`./assets/runners-apps/${item.icon}`] ?? "",
          desc: item.desc,
          url: isSafeUrl(item.url.trim()) ? item.url.trim() : "",
        })),
    }))
    .filter((group) => group.items.length > 0);
}

/** Korean screens read Korean; every other language reads English, the only other one in the json. */
export function pickText(text: RunnersText, locale: string): string {
  return (locale === "ko" ? text.ko : text.en) || text.en || text.ko || "";
}
