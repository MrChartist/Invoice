/** Copy text to the clipboard; falls back to a hidden textarea on insecure/old contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Open an external/app link without leaking the opener. */
export function openLink(url: string): void {
  if (/^(mailto|sms|tel|upi):/i.test(url)) {
    window.location.href = url;
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
