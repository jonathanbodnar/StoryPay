export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function formatDate(date: string | Date): string {
  // A plain calendar date (YYYY-MM-DD) is that day everywhere; read it in the
  // viewer's own calendar so a US time zone doesn't show the day before.
  const d =
    typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
      : new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function classNames(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function getStatusColor(status: string): { bg: string; text: string } {
  switch (status) {
    case 'draft': return { bg: 'bg-gray-100', text: 'text-gray-700' };
    case 'sent': return { bg: 'bg-blue-100', text: 'text-blue-700' };
    case 'opened': return { bg: 'bg-yellow-100', text: 'text-yellow-700' };
    case 'signed': return { bg: 'bg-purple-100', text: 'text-purple-700' };
    case 'paid': return { bg: 'bg-emerald-100', text: 'text-emerald-700' };
    case 'partially_paid': return { bg: 'bg-amber-100', text: 'text-amber-700' };
    case 'active': return { bg: 'bg-emerald-100', text: 'text-emerald-700' };
    case 'pending': return { bg: 'bg-yellow-100', text: 'text-yellow-700' };
    case 'failed': return { bg: 'bg-red-100', text: 'text-red-700' };
    case 'cancelled': return { bg: 'bg-gray-100', text: 'text-gray-500' };
    case 'refunded': return { bg: 'bg-red-100', text: 'text-red-700' };
    case 'partial_refund': return { bg: 'bg-orange-100', text: 'text-orange-700' };
    case 'completed': return { bg: 'bg-emerald-100', text: 'text-emerald-700' };
    case 'overdue': return { bg: 'bg-red-100', text: 'text-red-700' };
    default: return { bg: 'bg-gray-100', text: 'text-gray-700' };
  }
}

// ── Stage-change event bus ────────────────────────────────────────────────────
// Components fire `dispatchStageChange` after a successful API call.
// Other components call `onStageChange` (in a useEffect) to react.
//
// Payload uses `vcId` (venue_customer_id) so the conversation thread and
// the profile drawer — which are simultaneously open — can stay in sync.
// The leads page fires with `leadId` only; that lets the Kanban self-sync.
export interface StageChangeEvent {
  /** venue_customer_id — present when the caller patches /api/venue-customers */
  vcId?: string;
  /** lead id — present when the caller patches /api/leads */
  leadId?: string;
  pipelineId: string;
  stageId: string;
  stageName: string;
  stageColor: string;
}

const STAGE_CHANGE_EVENT = 'sp:stage-change';

export function dispatchStageChange(detail: StageChangeEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<StageChangeEvent>(STAGE_CHANGE_EVENT, { detail }));
}

export function onStageChange(
  handler: (detail: StageChangeEvent) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<StageChangeEvent>).detail);
  window.addEventListener(STAGE_CHANGE_EVENT, listener);
  return () => window.removeEventListener(STAGE_CHANGE_EVENT, listener);
}

/** Capitalize the first letter of each word in a name string. */
export function toTitleCase(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function generateToken(): string {
  const digits = '0123456789';
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  // First 8 characters are purely numerical for the invoice/proposal number
  for (let i = 0; i < 8; i++) {
    result += digits.charAt(Math.floor(Math.random() * digits.length));
  }
  // Remaining 56 characters are alphanumeric for security
  for (let i = 0; i < 56; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}


/**
 * Is this due date (a "YYYY-MM-DD" date, or a timestamp) before today in the
 * viewer's own time zone? Parsing a bare date with new Date() reads it as UTC
 * midnight, which in the US is the evening before, so a task due today showed
 * as overdue from the night before.
 */
export function isPastDueDate(due: string | null | undefined): boolean {
  const d = String(due ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return d < today;
}
