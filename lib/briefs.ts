/**
 * Pull brief IDs out of an ad name.
 * Prefixes: OO (Oregano), AOG (Garlic), CIN (Cinnamon). All three live in ClickUp's "Brief ID" field.
 * Matches OO-19041, AOG_10150, cin 24183, oo-8867 ... and normalises to "OO-19041", "AOG-10150", "CIN-24183".
 * The prefix must not follow a letter or digit, so resize/iteration references such as
 * rOO-19041, rCIN-101490, iCIN-101406 (and AOO-...) are not counted.
 */
const BRIEF_RE = /(?:^|[^A-Za-z0-9])(OO|AOG|CIN)[-_ ]?(\d{2,7})(?![0-9])/gi;

export function extractBriefIds(adName: string): string[] {
  const out = new Set<string>();
  for (const m of adName.matchAll(BRIEF_RE)) out.add(`${m[1].toUpperCase()}-${m[2]}`);
  return [...out];
}

/**
 * 6-digit brief IDs (OO-102573, AOG-100721, CIN-102186 ...) are created in a separate ClickUp workspace
 * (resize tasks link to them via "Org Task ID"), which our token cannot read. When one isn't found in
 * Resilia's workspace, list it on its own instead of as a broken "not found".
 */
export function isOtherWorkspaceBrief(briefId: string): boolean {
  return /^[A-Z]+-\d{6,}$/.test(briefId);
}
