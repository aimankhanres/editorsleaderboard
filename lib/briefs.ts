/**
 * Pull brief IDs out of an ad name.
 * Prefixes: OO (Oregano), AOG (Garlic), CIN (Cinnamon). All three live in ClickUp's "Brief ID" field.
 * Matches OO-19041, AOG_10150, cin 24183, CIN- 22957, oo-8867 ... and normalises to "OO-19041", "AOG-10150", "CIN-24183".
 * The prefix must not follow a letter or digit, so resize/iteration references such as
 * rOO-19041, rCIN-101490, iCIN-101406 (and AOO-...) are not counted.
 *
 * Internal briefs are named by number ("#103_W2_cs:MIA_pn: AOG") and become "AOG#103-W2", matched to the ClickUp
 * task with that name. Ads with no clean brief ID fall back to a glued prefix ("RSOO-4547" -> OO-4547), then to bare numbers ("PDP + b.h [23755 vh]", "102186 PDP"):
 * each standalone 4-6 digit number becomes "#23755", and the ClickUp lookup tries it as OO-, AOG- and CIN-.
 */
const BRIEF_RE = /(?:^|[^A-Za-z0-9])(OO|AOG|CIN)\s*[-_ ]?\s*(\d{2,7})(?![0-9])/gi;
// 4-6 digits not glued to other digits or letters (V1064, AUG112026); not a price ($55), dimension (1080x1920, 1080p), decimal or "#103" tag.
const BARE_RE = /(?<![0-9A-Za-z$#.,×])(\d{4,6})(?![0-9]|[.,]\d|\s?[xX×]\s?\d|p\b)/g;

const GLUED_RE = /(OO|AOG|CIN)[-_ ]?(\d{4,7})(?![0-9])/gi;

// "#103_W2", "#701_W9_cs", "#129_cs:LUCAS" (number then week or "cs" = creative strategist). Not "... .mp4 #3".
const INTERNAL_RE = /#\s?(\d{1,5})\s*[_ -]*\s*(?:W\s?(\d{1,2})(?!\d)|(?=cs))/gi;
const PRODUCT_RE = /pn\s*[:_-]?\s*(AOG|OO|CIN)(?![A-Za-z])/i;

export const BARE_PREFIX = '#';

export function extractBriefIds(adName: string): string[] {
  const out = new Set<string>();
  for (const m of adName.matchAll(BRIEF_RE)) out.add(`${m[1].toUpperCase()}-${m[2]}`);
  if (out.size) return [...out];
  // Internal briefs are named by number, not brief ID: "#103_W2_cs:MIA_pn: AOG_Offer_IMG". The ClickUp task has the
  // same name, so the key keeps the number, the week and the product: "AOG#103-W2".
  for (const m of adName.matchAll(INTERNAL_RE)) {
    const product = PRODUCT_RE.exec(adName)?.[1]?.toUpperCase() ?? '';
    out.add(`${product}#${Number(m[1])}${m[2] ? `-W${Number(m[2])}` : ''}`);
  }
  if (out.size) return [...out];
  // A prefix glued to the number ("RSOO-8469", "16x9AOG-26253", "rCIN-101490") still says which brief it is:
  // use it as is, so "RSOO-8469" can't be credited to AOG-8469.
  const glued = new Set<string>();
  for (const m of adName.matchAll(GLUED_RE)) { out.add(`${m[1].toUpperCase()}-${m[2]}`); glued.add(m[2]); }
  for (const m of adName.matchAll(BARE_RE)) {
    const n = m[1];
    if (glued.has(n)) continue;
    if (/^20[1-3]\d$/.test(n)) continue; // years: 2026-09-14, honest-review-2026
    if (/^0/.test(n)) continue;
    out.add(`${BARE_PREFIX}${n}`);
  }
  return [...out];
}

export const isBareNumber = (briefId: string) => /^#\d+$/.test(briefId);
/** "AOG#103-W2" / "#665-W9" / "AOG#129": an internal brief matched by task name, not by Brief ID */
export const isInternalKey = (briefId: string) => /^[A-Z]*#\d+(?:-W\d+)?$/.test(briefId) && !isBareNumber(briefId);
export function parseInternalKey(key: string): { product: string | null; num: number; week: number | null } | null {
  const m = /^([A-Z]*)#(\d+)(?:-W(\d+))?$/.exec(key);
  return m ? { product: m[1] || null, num: Number(m[2]), week: m[3] ? Number(m[3]) : null } : null;
}

/**
 * 6-digit brief IDs (OO-102573, AOG-100721, CIN-102186 ...) are created in a separate ClickUp workspace
 * (resize tasks link to them via "Org Task ID"), which our token cannot read. When one isn't found in
 * Resilia's workspace, list it on its own instead of as a broken "not found".
 */
export function isOtherWorkspaceBrief(briefId: string): boolean {
  return /^(?:[A-Z]+-|#)\d{6,}$/.test(briefId);
}
