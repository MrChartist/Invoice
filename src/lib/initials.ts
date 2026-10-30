/** Legal-form words that say nothing about who the party is ("Lotus Clinics Pvt Ltd" reads "LC"). */
const FORM = /^(pvt|private|ltd|limited|llp|inc|co|corp|plc|and)$/i;

/**
 * Avatar initials from letters and digits only (IOS-UI.md 2.11): bracketed notes such as "(demo)" and punctuation
 * never become an initial, so "Lotus Clinics Pvt Ltd (demo)" reads "LC", not "L(".
 */
export function initialsOf(name: string): string {
  const words = name
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  const parts = words.length > 1 ? words.filter((w, i) => i === 0 || !FORM.test(w)) : words;
  if (parts.length === 0) return '?';
  if (parts.length === 1) return [...parts[0]].slice(0, 2).join('').toUpperCase();
  return ([...parts[0]][0] + [...parts[parts.length - 1]][0]).toUpperCase();
}
