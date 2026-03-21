export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
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
    case 'active': return { bg: 'bg-emerald-100', text: 'text-emerald-700' };
    case 'pending': return { bg: 'bg-yellow-100', text: 'text-yellow-700' };
    case 'failed': return { bg: 'bg-red-100', text: 'text-red-700' };
    default: return { bg: 'bg-gray-100', text: 'text-gray-700' };
  }
}

export function generateToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
