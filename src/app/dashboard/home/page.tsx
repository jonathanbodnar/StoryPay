'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  UserPlus, Phone, MessageCircle, CreditCard, FileText,
  Calendar, Star, Store, BarChart3, MailOpen, Inbox, ChevronRight,
} from 'lucide-react';

/**
 * Mobile / tablet home hub. Acts as the default landing screen for app-like
 * use. Above the breakpoint (`lg:`) it redirects to the standard dashboard.
 */

type MetricState = {
  unreadMessages: number;
  newLeadsThisWeek: number;
  upcomingEventsToday: number;
};

export default function MobileHomePage() {
  const [metrics, setMetrics] = useState<MetricState>({
    unreadMessages: 0,
    newLeadsThisWeek: 0,
    upcomingEventsToday: 0,
  });

  useEffect(() => {
    // Unread messages — same endpoint as the sidebar badge
    fetch('/api/conversations/unread-count')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: number } | null) => {
        if (d && typeof d.count === 'number') {
          setMetrics((m) => ({ ...m, unreadMessages: d.count ?? 0 }));
        }
      })
      .catch(() => {});

    // Leads count (best effort — endpoint may not exist on all plans)
    fetch('/api/listing/leads/summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { newThisWeek?: number } | null) => {
        if (d && typeof d.newThisWeek === 'number') {
          setMetrics((m) => ({ ...m, newLeadsThisWeek: d.newThisWeek ?? 0 }));
        }
      })
      .catch(() => {});

    // Today's events (best effort — silently fails if no endpoint)
    fetch('/api/calendar/today/count')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: number } | null) => {
        if (d && typeof d.count === 'number') {
          setMetrics((m) => ({ ...m, upcomingEventsToday: d.count ?? 0 }));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="lg:hidden -mx-6 sm:-mx-8 -mt-6">
      {/* Hero greeting */}
      <div className="px-6 pt-2 pb-4">
        <h1 className="font-heading text-2xl text-gray-900">Good day</h1>
        <p className="mt-0.5 text-sm text-gray-500">Here&apos;s what&apos;s happening at your venue.</p>
      </div>

      {/* Metric cards */}
      <div className="px-6 pb-4">
        <div className="grid grid-cols-3 gap-2.5">
          <MetricCard
            icon={<MailOpen size={16} />}
            label="Unread"
            value={metrics.unreadMessages}
            href="/dashboard/conversations"
            tint="bg-rose-50 text-rose-700"
          />
          <MetricCard
            icon={<Inbox size={16} />}
            label="New leads"
            value={metrics.newLeadsThisWeek}
            href="/dashboard/leads"
            tint="bg-amber-50 text-amber-700"
          />
          <MetricCard
            icon={<Calendar size={16} />}
            label="Today"
            value={metrics.upcomingEventsToday}
            href="/dashboard/calendar"
            tint="bg-emerald-50 text-emerald-700"
          />
        </div>
      </div>

      {/* Quick actions */}
      <div className="rounded-t-3xl bg-gray-50 px-6 pb-32 pt-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">Quick Actions</h2>
        <div className="grid grid-cols-4 gap-x-3 gap-y-5">
          <Tile icon={<UserPlus    size={22} />} label="Add Contact"     href="/dashboard/contacts" />
          <Tile icon={<Phone       size={22} />} label="Make a Call"     href="/dashboard/contacts" />
          <Tile icon={<MessageCircle size={22} />} label="New Message"   href="/dashboard/conversations" />
          <Tile icon={<CreditCard  size={22} />} label="New Payment"     href="/dashboard/payments/new" />
          <Tile icon={<FileText    size={22} />} label="New Proposal"    href="/dashboard/proposals" />
          <Tile icon={<Calendar    size={22} />} label="Book Event"      href="/dashboard/calendar" />
          <Tile icon={<Star        size={22} />} label="Request Review"  href="/dashboard/listing/reviews" />
          <Tile icon={<Store       size={22} />} label="Venue Listing"   href="/dashboard/listing" />
        </div>

        {/* Secondary navigation list */}
        <h2 className="mb-3 mt-8 text-sm font-semibold text-gray-700">More</h2>
        <ul className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <RowLink href="/dashboard/marketing/analytics" icon={<BarChart3 size={18} />} label="Marketing Analytics" />
          <RowLink href="/dashboard/help" icon={<MessageCircle size={18} />} label="Help Center" />
          <RowLink href="/dashboard/settings" icon={<Store size={18} />} label="Settings" />
        </ul>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function MetricCard({
  icon, label, value, href, tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  href: string;
  tint: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-gray-200 bg-white p-3 transition-colors active:bg-gray-50"
    >
      <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full ${tint}`}>
        {icon}
      </div>
      <div className="font-heading text-xl text-gray-900 tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
    </Link>
  );
}

function Tile({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-2 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-800 shadow-sm transition-colors active:bg-gray-100">
        {icon}
      </span>
      <span className="text-[11px] font-medium leading-tight text-gray-700">{label}</span>
    </Link>
  );
}

function RowLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <li className="border-b border-gray-100 last:border-b-0">
      <Link
        href={href}
        className="flex items-center gap-3 px-4 py-3.5 text-sm text-gray-800 transition-colors active:bg-gray-50"
      >
        <span className="text-gray-500">{icon}</span>
        <span className="flex-1">{label}</span>
        <ChevronRight size={16} className="text-gray-300" />
      </Link>
    </li>
  );
}
