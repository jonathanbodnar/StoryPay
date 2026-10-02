'use client';

import { useEffect } from 'react';
import { MessageCircle } from 'lucide-react';

/**
 * /dashboard/support — an old address. Support happens in the help panel's
 * Support tab (AskAIWidget → SupportPanel), where the StoryVenue team sees and
 * answers it; this page opens that tab. (Its old form saved tickets to a table
 * nothing read.)
 */
export default function SupportPage() {
  useEffect(() => {
    // The help panel (in the dashboard layout) listens for this once it's mounted.
    const t = setTimeout(() => window.dispatchEvent(new Event('open-support')), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
        <MessageCircle size={26} className="text-gray-700" />
      </div>
      <h1 className="font-heading text-2xl font-semibold text-gray-900">Support</h1>
      <p className="mt-2 text-sm text-gray-500">
        Message the StoryVenue team from the Support tab in the help panel.
      </p>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event('open-support'))}
        className="mt-6 inline-flex items-center justify-center rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
      >
        Open support
      </button>
    </div>
  );
}
