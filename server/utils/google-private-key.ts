/**
 * Google service-account keys pasted into Replit Secrets arrive in several
 * shapes (literal "\\n", Windows line endings, or all on one line). Turn any of
 * them back into the PEM the Google client expects.
 */
export function normalizePrivateKey(raw: string): string {
  let key = raw;
  if (key.includes('\\n')) {
    key = key.replace(/\\n/g, '\n');
  }
  key = key
    .replace(/\\r\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  if (!key.includes('\n') && key.includes('-----BEGIN PRIVATE KEY-----')) {
    const begin = '-----BEGIN PRIVATE KEY-----';
    const end = '-----END PRIVATE KEY-----';
    const beginIdx = key.indexOf(begin);
    const endIdx = key.indexOf(end);
    if (beginIdx !== -1 && endIdx !== -1) {
      const body = key.slice(beginIdx + begin.length, endIdx).replace(/\s+/g, '');
      key = `${begin}\n${body.match(/.{1,64}/g)?.join('\n') || body}\n${end}\n`;
    }
  }
  return key;
}
