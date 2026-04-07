'use client';

import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';

export default function AskAIPage() {
  useEffect(() => {
    // Auto-open the widget after a short delay
    const timer = setTimeout(() => {
      // Dispatch a custom event the widget can listen for, or just show instructions
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg mb-5" style={{ backgroundColor: '#293745' }}>
        <Sparkles size={28} className="text-white" />
      </div>
      <h1 className="font-heading text-2xl text-gray-900 mb-3">Ask AI</h1>
      <p className="text-sm text-gray-500 max-w-sm leading-relaxed mb-6">
        Ask AI is available on every page as a floating chat bubble in the bottom-right corner of your dashboard.
      </p>
      <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4 text-sm text-gray-600 max-w-sm">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white shadow-md" style={{ backgroundColor: '#293745' }}>
          <Sparkles size={18} />
        </div>
        <p className="text-left">Look for the <strong>sparkle icon</strong> in the <strong>bottom-right corner</strong> of any dashboard page to open Ask AI.</p>
      </div>
    </div>
  );
}
