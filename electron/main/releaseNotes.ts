// "What's new" lines for the update window, read from the GitHub release of the version being offered.
//
// Release body format (RELEASE_NOTES.md in the repo becomes the body; see README "Releasing"):
//
//   ## 한국어
//   - 한 줄에 바뀐 점 하나, 합니다체로 씁니다.
//   ## English
//   - One change per line.
//
// electron-updater hands the GitHub body over as HTML (`<h2>한국어</h2><ul><li>…</li></ul>`); a plain Markdown body is
// read too. Only text comes out: tags are dropped and entities decoded, and the page shows the lines as text nodes,
// so nothing from the release is ever run or inserted as HTML.

/** Most lines kept; the box scrolls past five, and a longer list is a sign the body is not in this format. */
const MAX_LINES = 12;
const MAX_LINE_LENGTH = 300;

export type NotesLanguage = "ko" | "en";

/** The list under `## 한국어` (Korean) or `## English` (everything else), or null when the body has none. */
export function releaseNoteLines(notes: unknown, language: NotesLanguage): string[] | null {
  const body = noteText(notes);
  if (!body) return null;
  const heading = language === "ko" ? "한국어" : "English";
  const lines = /<\s*h[1-6][\s>]/i.test(body) ? fromHtml(body, heading) : fromMarkdown(body, heading);
  const clean = lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .map((line) => (line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH - 1)}…` : line))
    .slice(0, MAX_LINES);
  return clean.length > 0 ? clean : null;
}

/** electron-updater gives a string, or a list of `{ version, note }` when it gathers several releases. */
function noteText(notes: unknown): string | null {
  if (typeof notes === "string") return notes;
  // Why: only the offered version's notes are wanted, which is the first entry of the list.
  if (Array.isArray(notes) && notes.length > 0 && typeof notes[0]?.note === "string") return notes[0].note;
  return null;
}

function fromHtml(html: string, heading: string): string[] {
  const parts = html.split(/<\s*h[1-6][^>]*>/i).slice(1);
  for (const part of parts) {
    const end = part.search(/<\s*\/\s*h[1-6]\s*>/i);
    if (end < 0) continue;
    if (plain(part.slice(0, end)) !== heading) continue;
    const items = part.slice(end).match(/<\s*li[^>]*>[\s\S]*?<\s*\/\s*li\s*>/gi) ?? [];
    return items.map(plain);
  }
  return [];
}

function fromMarkdown(text: string, heading: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && line.replace(/^#+\s*/, "").trim() === heading);
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    const item = line.match(/^\s*[-*]\s+(.*)$/);
    if (item) out.push(item[1]);
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Text of an HTML fragment: tags removed, the common entities and numeric ones decoded. */
function plain(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .trim();
}
