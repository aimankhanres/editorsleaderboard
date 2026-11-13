/**
 * Pull brief IDs out of an ad name.
 * Matches OO-19041, OO_19041, OO 19041, oo-8867 ... and normalises to "OO-19041".
 */
const BRIEF_RE = /(?:^|[^A-Za-z0-9])OO[-_ ]?(\d{2,7})(?![0-9])/gi;

export function extractBriefIds(adName: string): string[] {
  const out = new Set<string>();
  for (const m of adName.matchAll(BRIEF_RE)) out.add(`OO-${m[1]}`);
  return [...out];
}
