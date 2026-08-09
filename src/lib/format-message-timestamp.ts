/**
 * Shared "how long ago + exact date/time" timestamp used on every message in
 * the venue conversations page and the super admin support inbox (bride
 * replies), so agents always see both without hovering.
 *
 * Format: "1 hr ago. 4-5-26 8:15am"
 */

/** "4-5-26 8:15am" — no leading zeros, lowercase am/pm, no space before it. */
export function formatAbsoluteStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear() % 100;
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${month}-${day}-${year} ${hours}:${minutes}${ampm}`;
}

/** "just now" / "5 mins ago" / "1 hr ago" / "3 days ago" — minutes → hours →
 *  days, uncapped (never rolls over to weeks/months). */
export function formatRelativeStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

/** Combined "1 hr ago. 4-5-26 8:15am" — the standard per-message timestamp. */
export function formatMessageTimestamp(iso: string | null | undefined): string {
  const relative = formatRelativeStamp(iso);
  const absolute = formatAbsoluteStamp(iso);
  if (relative && absolute) return `${relative}. ${absolute}`;
  return relative || absolute;
}
