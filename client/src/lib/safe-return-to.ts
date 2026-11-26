/**
 * Where to go after signing in: the ?returnTo= page the person was trying to
 * reach (set by App.tsx when a signed-out visitor opens a deep link), or home.
 * Only same-site paths are allowed, so the parameter can't send anyone to
 * another website.
 */
export function safeReturnTo(search: string, origin: string = window.location.origin): string {
  const raw = new URLSearchParams(search).get('returnTo');
  if (!raw || !raw.startsWith('/')) return '/';
  // Resolve it the way the browser will (which strips tabs/newlines and
  // treats backslashes as slashes, so text-prefix checks can be fooled, e.g.
  // "/\t/evil.example" -> "//evil.example") and require the same origin.
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return '/';
  }
  if (url.origin !== origin || url.pathname.startsWith('/login')) return '/';
  return url.pathname + url.search + url.hash;
}
