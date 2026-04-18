import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Mail, Megaphone, Workflow, FileStack, BarChart3 } from 'lucide-react';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function MarketingEmailHubPage() {
  const venueId = await getVenueId();
  if (!venueId) redirect('/dashboard');

  const cards = [
    {
      href: '/dashboard/marketing/analytics',
      title: 'Analytics',
      desc: 'Campaign sends and opens, form volume, pipeline value, and loss reasons.',
      icon: BarChart3,
    },
    {
      href: '/dashboard/marketing/email/templates',
      title: 'Email templates',
      desc: 'Drag-and-drop layouts, subject lines, and merge tags for venue-branded messages.',
      icon: FileStack,
    },
    {
      href: '/dashboard/marketing/email/campaigns',
      title: 'Campaigns',
      desc: 'Send a template to a segment, schedule sends, or fire a one-off broadcast.',
      icon: Megaphone,
    },
    {
      href: '/dashboard/marketing/email/automations',
      title: 'Automations',
      desc: 'When someone gets a tag, enters a pipeline stage, or clicks a trigger link, run delays and emails.',
      icon: Workflow,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        ← Dashboard
      </Link>
      <div className="mb-8 flex items-start gap-3">
        <Mail className="mt-1 shrink-0 text-brand-600" size={32} />
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Marketing email</h1>
          <p className="mt-1 text-sm text-gray-600">
            Native email builder, campaigns, and automations — all stored in StoryPay. Suppressions and unsubscribe
            links are honored automatically.
          </p>
        </div>
      </div>
      <ul className="grid gap-4 sm:grid-cols-1">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <li key={c.href}>
              <Link
                href={c.href}
                className="flex gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:shadow-md"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <Icon size={24} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{c.title}</h2>
                  <p className="mt-1 text-sm text-gray-600">{c.desc}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
