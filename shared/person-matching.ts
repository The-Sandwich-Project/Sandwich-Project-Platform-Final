/**
 * Person-matching helpers shared by the people audit and backfill scripts
 * (scripts/) and the volunteer sheet sync (server/). Pure functions, no I/O.
 * The rules they implement are in docs/data-model.md ("Matching order").
 */
// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

export function normName(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normPhone(s: string | null | undefined): string {
  let d = (s || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d;
}

export function normEmail(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase();
}

/** "Sarah P." / "Sarah P" / single word → abbreviated. */
export function isAbbreviated(name: string): boolean {
  const parts = normName(name).split(' ').filter(Boolean);
  if (parts.length <= 1) return true;
  return /^[\p{L}]$/u.test(parts[parts.length - 1].replace(/[.'-]/g, ''));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Common English nickname groups. Not exhaustive; the audit only uses it to
// *suggest* matches for a person to confirm.
const NICKNAME_GROUPS: string[][] = [
  ['laura', 'laurie', 'lauren', 'lori', 'lorrie'],
  ['william', 'bill', 'billy', 'will', 'willie', 'liam'],
  ['robert', 'bob', 'bobby', 'rob', 'robbie', 'bert'],
  ['richard', 'rick', 'ricky', 'rich', 'dick'],
  ['elizabeth', 'liz', 'lizzie', 'beth', 'betsy', 'betty', 'eliza', 'libby'],
  ['katherine', 'catherine', 'kathryn', 'kate', 'katie', 'kathy', 'cathy', 'kat', 'kay', 'katy'],
  ['margaret', 'maggie', 'meg', 'peggy', 'marge', 'greta'],
  ['jennifer', 'jen', 'jenny', 'jenn'],
  ['jessica', 'jess', 'jessie'],
  ['rebecca', 'becky', 'becca'],
  ['susan', 'sue', 'susie', 'suzanne', 'suzy'],
  ['patricia', 'pat', 'patty', 'tricia', 'trish'],
  ['deborah', 'debra', 'deb', 'debbie'],
  ['christine', 'christina', 'chris', 'christy', 'christie', 'kristy', 'tina'],
  ['christopher', 'chris', 'topher'],
  ['michael', 'mike', 'mikey', 'mick'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['john', 'jon', 'johnny', 'jack'],
  ['jonathan', 'jon', 'jonny', 'nathan'],
  ['joseph', 'joe', 'joey'],
  ['thomas', 'tom', 'tommy'],
  ['daniel', 'dan', 'danny'],
  ['david', 'dave', 'davey'],
  ['matthew', 'matt', 'matty'],
  ['anthony', 'tony'],
  ['andrew', 'andy', 'drew'],
  ['steven', 'stephen', 'steve'],
  ['edward', 'ed', 'eddie', 'ted', 'ned'],
  ['charles', 'charlie', 'chuck', 'chas'],
  ['benjamin', 'ben', 'benny'],
  ['samuel', 'sam', 'sammy'],
  ['samantha', 'sam', 'sammy'],
  ['alexander', 'alex', 'al', 'xander'],
  ['alexandra', 'alex', 'lexi', 'sandra', 'sandy'],
  ['nicholas', 'nick', 'nicky'],
  ['nicole', 'nikki', 'nicky'],
  ['victoria', 'vicky', 'tori'],
  ['abigail', 'abby', 'gail'],
  ['amanda', 'mandy'],
  ['kimberly', 'kim'],
  ['pamela', 'pam'],
  ['cynthia', 'cindy'],
  ['barbara', 'barb', 'barbie'],
  ['dorothy', 'dot', 'dottie'],
  ['gregory', 'greg'],
  ['jeffrey', 'geoffrey', 'jeff', 'geoff'],
  ['kenneth', 'ken', 'kenny'],
  ['ronald', 'ron', 'ronnie'],
  ['donald', 'don', 'donnie'],
  ['timothy', 'tim', 'timmy'],
  ['zachary', 'zach', 'zack'],
  ['allison', 'alison', 'ali', 'allie'],
  ['melissa', 'missy', 'mel'],
  ['stephanie', 'steph'],
  ['theresa', 'teresa', 'terri', 'terry', 'tess'],
  ['frances', 'fran', 'frannie'],
  ['francis', 'frank', 'frankie'],
  ['lawrence', 'larry'],
  ['leonard', 'leo', 'len', 'lenny'],
];
const NICK_INDEX = new Map<string, Set<number>>();
NICKNAME_GROUPS.forEach((g, i) =>
  g.forEach((n) => {
    if (!NICK_INDEX.has(n)) NICK_INDEX.set(n, new Set());
    NICK_INDEX.get(n)!.add(i);
  })
);
export function isNickname(a: string, b: string): boolean {
  const ga = NICK_INDEX.get(a);
  const gb = NICK_INDEX.get(b);
  if (!ga || !gb) return false;
  for (const g of ga) if (gb.has(g)) return true;
  return false;
}

/**
 * Do two names plausibly belong to the same person, for joining records that
 * share an email or phone? Same first name (or a known nickname, or one is
 * just an initial) AND same last name (or one is just an initial, or one side
 * has no last name). Deliberately strict: typos like Jon/John or Myler/Mylar
 * are NOT accepted here, so a family sharing a phone isn't merged; those go
 * to section 2b / 3 for a person to decide.
 */
export function namesCompatible(a: string, b: string): boolean {
  const x = normName(a).replace(/\./g, '').split(' ').filter(Boolean);
  const y = normName(b).replace(/\./g, '').split(' ').filter(Boolean);
  if (x.length === 0 || y.length === 0) return true;
  const part = (p: string, q: string) =>
    p === q || (p.length === 1 && q.startsWith(p)) || (q.length === 1 && p.startsWith(q));
  const firstOk = part(x[0], y[0]) || isNickname(x[0], y[0]);
  if (x.length === 1 || y.length === 1) return firstOk;
  return firstOk && part(x[x.length - 1], y[y.length - 1]);
}
