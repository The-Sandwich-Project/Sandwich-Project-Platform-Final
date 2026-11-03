export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

export function openExternalUrl(url: string): void {
  if (typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function openMaps(address: string): void {
  openExternalUrl(`https://maps.google.com?q=${encodeURIComponent(address)}`);
}

export function callPhone(phoneNumber: string): void {
  if (typeof window === 'undefined') return;
  window.location.href = `tel:${phoneNumber}`;
}

export function sendSms(phoneNumber: string, message?: string): void {
  if (typeof window === 'undefined') return;
  const suffix = message ? `?body=${encodeURIComponent(message)}` : '';
  window.location.href = `sms:${phoneNumber}${suffix}`;
}

export async function shareResource(resource: { title?: string; text?: string; url: string }): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    await navigator.share(resource);
    return true;
  }
  openExternalUrl(resource.url);
  return false;
}

// Web fallback for the secure-storage contract. Expo/native should replace this
// module with SecureStore/Keychain-backed implementations.
export async function storeSecureValue(key: string, value: string): Promise<void> {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`mobile:${key}`, value);
}

export async function getSecureValue(key: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(`mobile:${key}`);
}

export async function removeSecureValue(key: string): Promise<void> {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(`mobile:${key}`);
}
