'use client';

import { useMemo } from 'react';
import { parseConciergeMessage, tidyEmailText } from '@/lib/venue-concierge/message-format';
import { EmailRich } from '@/components/email/EmailRich';

// Emails everywhere (venue side + super-admin Support Inbox) now render through
// the single shared card so the look & feel is identical SaaS-wide.
export { EmailThreadCard as ConciergeEmailCard } from '@/components/email/EmailThreadCard';

/**
 * Plain concierge message body (an in-app chat message) — just the new reply,
 * linkified. Signature/quoted trails only appear on email messages, which are
 * rendered with the shared EmailThreadCard instead.
 */
export function ConciergeMessageBody({ body }: { body: string }) {
  const { reply } = useMemo(() => parseConciergeMessage(body), [body]);
  return (
    <div className="text-[13px] leading-relaxed text-gray-900">
      <EmailRich text={tidyEmailText(reply)} />
    </div>
  );
}
