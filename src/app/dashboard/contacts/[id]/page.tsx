'use client';

import { useParams, useSearchParams } from 'next/navigation';
import ContactProfilePanel, { type Tab } from '@/components/contacts/ContactProfilePanel';

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  const initialTab = ((): Tab => {
    const t = (searchParams?.get('tab') || '').toLowerCase();
    if (t === 'concierge' || t === 'notes' || t === 'timeline' || t === 'payments' || t === 'tasks' || t === 'documents') {
      return t as Tab;
    }
    return 'overview';
  })();

  return <ContactProfilePanel customerId={id} initialTab={initialTab} />;
}
