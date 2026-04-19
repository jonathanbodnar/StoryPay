'use client';

import { useEffect, useState } from 'react';
import { Mail, MessageSquare, Loader2, Save, CheckCircle2, Calendar, CreditCard } from 'lucide-react';
import type { ReminderOffset } from '@/lib/appointment-reminders';
import { DEFAULT_APPOINTMENT_REMINDER_OFFSETS, normalizeReminderOffsets } from '@/lib/appointment-reminders';
import {
  DEFAULT_PAYMENT_REMINDER_OFFSETS,
  normalizePaymentReminderOffsets,
} from '@/lib/payment-reminders';

type Settings = Record<string, boolean>;

interface NotifItem {
 key: string;
 label: string;
 description: string;
}

const EMAIL_NOTIFICATIONS: NotifItem[] = [
 { key: 'email_payment_received', label: 'Payment received', description: 'When a payment is successfully processed' },
 { key: 'email_payment_failed', label: 'Payment failed', description: 'When a payment attempt fails' },
 { key: 'email_invoice_paid', label: 'Invoice paid', description: 'When an invoice is marked as paid' },
 { key: 'email_proposal_signed', label: 'Proposal signed', description: 'When a client signs a proposal' },
 { key: 'email_new_customer', label: 'New customer', description: 'When a new customer is added' },
 { key: 'email_subscription_created', label: 'Subscription created', description: 'When a new subscription starts' },
 { key: 'email_subscription_cancelled', label: 'Subscription cancelled', description: 'When a subscription is cancelled' },
 { key: 'email_refund_issued', label: 'Refund issued', description: 'When a refund is processed' },
 { key: 'email_weekly_digest', label: 'Weekly digest', description: 'Summary of your weekly activity' },
];

const SMS_NOTIFICATIONS: NotifItem[] = [
 { key: 'sms_payment_received', label: 'Payment received', description: 'Get a text when a payment is received' },
 { key: 'sms_payment_failed', label: 'Payment failed', description: 'Get a text when a payment fails' },
 { key: 'sms_high_value_payment', label: 'High-value payments', description: 'Get a text for payments over $1,000' },
 { key: 'sms_proposal_signed', label: 'Proposal signed', description: 'Get a text when a client signs' },
 { key: 'sms_subscription_created', label: 'Subscription created', description: 'Get a text when a subscription starts' },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
 return (
 <button
 type="button"
 role="switch"
 aria-checked={checked}
 onClick={() => onChange(!checked)}
 className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${
 checked ? 'bg-gray-900' : 'bg-gray-200'
 }`}
 >
 <span className={`inline-block h-4 w-4 transform rounded-full border border-gray-200 bg-white transition-transform duration-200 ${
 checked ? 'translate-x-6' : 'translate-x-1'
 }`} />
 </button>
 );
}

function NotifRow({ item, value, onChange }: { item: NotifItem; value: boolean; onChange: (v: boolean) => void }) {
 return (
 <div className="flex items-center justify-between py-4 border-b border-gray-50 last:border-0">
 <div className="flex-1 pr-8">
 <p className="text-sm font-semibold text-gray-900">{item.label}</p>
 <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
 </div>
 <Toggle checked={value} onChange={onChange} />
 </div>
 );
}

function padOffsets(rows: ReminderOffset[]): ReminderOffset[] {
 const out = rows.slice(0, 5);
 while (out.length < 5) out.push({ d: 0, h: 0, m: 0 });
 return out;
}

function padPayOffsets(rows: ReminderOffset[]): ReminderOffset[] {
 const out = rows.slice(0, 3);
 while (out.length < 3) out.push({ d: 0, h: 0, m: 0 });
 return out;
}

export default function NotificationsPage() {
 const [settings, setSettings] = useState<Settings>({});
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [saved, setSaved] = useState(false);

 const [apptLoading, setApptLoading] = useState(true);
 const [apptEnabled, setApptEnabled] = useState(true);
 const [apptCount, setApptCount] = useState(3);
 const [apptRows, setApptRows] = useState<ReminderOffset[]>(() => padOffsets([...DEFAULT_APPOINTMENT_REMINDER_OFFSETS]));
 const [apptSaving, setApptSaving] = useState(false);
 const [apptSaved, setApptSaved] = useState(false);

 const [payLoading, setPayLoading] = useState(true);
 const [payEnabled, setPayEnabled] = useState(true);
 const [payCount, setPayCount] = useState(3);
 const [payRows, setPayRows] = useState<ReminderOffset[]>(() => padPayOffsets([...DEFAULT_PAYMENT_REMINDER_OFFSETS]));
 const [paySaving, setPaySaving] = useState(false);
 const [paySaved, setPaySaved] = useState(false);

 useEffect(() => {
 fetch('/api/notifications').then(r => r.json()).then(d => {
 setSettings(d);
 }).finally(() => setLoading(false));
 }, []);

 useEffect(() => {
 fetch('/api/venues/me', { cache: 'no-store' })
 .then(r => (r.ok ? r.json() : null))
 .then((v) => {
 if (!v) return;
 if (typeof v.appointment_reminders_enabled === 'boolean') setApptEnabled(v.appointment_reminders_enabled);
 const rawAppt = v.appointment_reminder_offsets;
 const normAppt = normalizeReminderOffsets(rawAppt);
 setApptRows(padOffsets(normAppt));
 setApptCount(Math.min(5, Math.max(1, normAppt.length || 3)));
 if (typeof v.payment_reminders_enabled === 'boolean') setPayEnabled(v.payment_reminders_enabled);
 const rawPay = v.payment_reminder_offsets;
 const normPay = normalizePaymentReminderOffsets(rawPay);
 setPayRows(padPayOffsets(normPay));
 setPayCount(Math.min(3, Math.max(1, normPay.length || 3)));
 })
 .finally(() => {
 setApptLoading(false);
 setPayLoading(false);
 });
 }, []);

 function toggle(key: string, value: boolean) {
 setSettings(prev => ({ ...prev, [key]: value }));
 }

 async function save() {
 setSaving(true);
 try {
 await fetch('/api/notifications', {
 method: 'PUT',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(settings),
 });
 setSaved(true);
 setTimeout(() => setSaved(false), 3000);
 } finally {
 setSaving(false);
 }
 }

 async function saveAppointmentReminders() {
 setApptSaving(true);
 setApptSaved(false);
 try {
 const slice = apptRows.slice(0, apptCount);
 const res = await fetch('/api/venues/me', {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 appointment_reminders_enabled: apptEnabled,
 appointment_reminder_offsets: slice,
 }),
 });
 if (res.ok) {
 setApptSaved(true);
 setTimeout(() => setApptSaved(false), 3000);
 }
 } finally {
 setApptSaving(false);
 }
 }

 async function savePaymentReminders() {
 setPaySaving(true);
 setPaySaved(false);
 try {
 const slice = payRows.slice(0, payCount);
 const res = await fetch('/api/venues/me', {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 payment_reminders_enabled: payEnabled,
 payment_reminder_offsets: slice,
 }),
 });
 if (res.ok) {
 setPaySaved(true);
 setTimeout(() => setPaySaved(false), 3000);
 }
 } finally {
 setPaySaving(false);
 }
 }

 function patchRow(i: number, field: 'd' | 'h' | 'm', val: number) {
 setApptRows((prev) => {
 const next = [...prev];
 const row = { ...next[i], [field]: val };
 next[i] = row;
 return next;
 });
 }

 function patchPayRow(i: number, field: 'd' | 'h' | 'm', val: number) {
 setPayRows((prev) => {
 const next = [...prev];
 const row = { ...next[i], [field]: val };
 next[i] = row;
 return next;
 });
 }

 if (loading) {
 return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400"/></div>;
 }

 return (
 <div>
 {/* Header */}
 <div className="mb-8">
 <h1 className="font-heading text-2xl text-gray-900">Notifications</h1>
 <p className="mt-1 text-sm text-gray-500">Manage how you receive notifications about your account activity</p>
 </div>

 <div className="space-y-5 max-w-2xl">

 {/* Email Notifications */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="flex items-center gap-2.5 px-6 py-4 border-b border-gray-200">
 <Mail size={16} className="text-gray-400"/>
 <h2 className="text-sm font-semibold text-gray-900">Email Notifications</h2>
 </div>
 <div className="px-6">
 {EMAIL_NOTIFICATIONS.map(item => (
 <NotifRow
 key={item.key}
 item={item}
 value={settings[item.key] ?? false}
 onChange={v => toggle(item.key, v)}
 />
 ))}
 </div>
 </div>

 {/* SMS Notifications */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="flex items-center gap-2.5 px-6 py-4 border-b border-gray-200">
 <MessageSquare size={16} className="text-gray-400"/>
 <h2 className="text-sm font-semibold text-gray-900">SMS Notifications</h2>
 </div>
 <div className="px-6">
 {SMS_NOTIFICATIONS.map(item => (
 <NotifRow
 key={item.key}
 item={item}
 value={settings[item.key] ?? false}
 onChange={v => toggle(item.key, v)}
 />
 ))}
 </div>
 </div>

 {/* Appointment email reminders */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="flex items-center gap-2.5 px-6 py-4 border-b border-gray-200">
 <Calendar size={16} className="text-gray-400"/>
 <div>
 <h2 className="text-sm font-semibold text-gray-900">Appointment email reminders</h2>
 <p className="text-xs text-gray-400 mt-0.5">Email your customer before scheduled calendar appointments (not recurring series). Requires a customer email on the event.</p>
 </div>
 </div>
 <div className="px-6 py-5 space-y-4">
 {apptLoading ? (
 <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-gray-300"/></div>
 ) : (
 <>
 <div className="flex items-center justify-between py-1">
 <span className="text-sm font-medium text-gray-900">Send reminder emails</span>
 <Toggle checked={apptEnabled} onChange={setApptEnabled} />
 </div>
 <div>
 <label className="block text-xs font-medium text-gray-500 mb-1.5">How many reminders (1–5)</label>
 <select
 value={apptCount}
 onChange={(e) => setApptCount(Number(e.target.value))}
 className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none"
 >
 {[1, 2, 3, 4, 5].map((n) => (
 <option key={n} value={n}>{n}</option>
 ))}
 </select>
 </div>
 <p className="text-xs text-gray-400">Each reminder is sent this long before the appointment start (venue time zone).</p>
 <div className="space-y-3">
 {Array.from({ length: apptCount }, (_, i) => (
 <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
 <span className="text-gray-500 w-24 shrink-0">Reminder {i + 1}</span>
 <input
 type="number"
 min={0}
 max={365}
 value={apptRows[i]?.d ?? 0}
 onChange={(e) => patchRow(i, 'd', Math.max(0, Math.min(365, parseInt(e.target.value, 10) || 0)))}
 className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-gray-900"
 />
 <span className="text-gray-400">days</span>
 <input
 type="number"
 min={0}
 value={apptRows[i]?.h ?? 0}
 onChange={(e) => patchRow(i, 'h', Math.max(0, parseInt(e.target.value, 10) || 0))}
 className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-gray-900"
 />
 <span className="text-gray-400">hours</span>
 <input
 type="number"
 min={0}
 max={59}
 value={apptRows[i]?.m ?? 0}
 onChange={(e) => patchRow(i, 'm', Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
 className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-gray-900"
 />
 <span className="text-gray-400">min</span>
 </div>
 ))}
 </div>
 <button
 type="button"
 onClick={() => void saveAppointmentReminders()}
 disabled={apptSaving}
 className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
 style={{ backgroundColor: '#1b1b1b' }}
 >
 {apptSaving ? <Loader2 size={14} className="animate-spin"/> : apptSaved ? <CheckCircle2 size={14} /> : <Save size={14} />}
 {apptSaving ? 'Saving...' : apptSaved ? 'Saved!' : 'Save appointment reminders'}
 </button>
 </>
 )}
 </div>
 </div>

 {/* Payment due email reminders (installments) */}
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 <div className="flex items-center gap-2.5 px-6 py-4 border-b border-gray-200">
 <CreditCard size={16} className="text-gray-400"/>
 <div>
 <h2 className="text-sm font-semibold text-gray-900">Payment due email reminders</h2>
 <p className="text-xs text-gray-400 mt-0.5">Email your customer before each installment due date on signed proposals (installment plans). Uses venue time zone. Requires a customer email on the proposal.</p>
 </div>
 </div>
 <div className="px-6 py-5 space-y-4">
 {payLoading ? (
 <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-gray-300"/></div>
 ) : (
 <>
 <div className="flex items-center justify-between py-1">
 <span className="text-sm font-medium text-gray-900">Send payment reminder emails</span>
 <Toggle checked={payEnabled} onChange={setPayEnabled} />
 </div>
 <div>
 <label className="block text-xs font-medium text-gray-500 mb-1.5">How many reminders (1–3)</label>
 <select
 value={payCount}
 onChange={(e) => setPayCount(Number(e.target.value))}
 className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none"
 >
 {[1, 2, 3].map((n) => (
 <option key={n} value={n}>{n}</option>
 ))}
 </select>
 </div>
 <p className="text-xs text-gray-400">Each reminder is sent this long before the due time (noon local on the due date).</p>
 <div className="space-y-3">
 {Array.from({ length: payCount }, (_, i) => (
 <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
 <span className="text-gray-500 w-24 shrink-0">Reminder {i + 1}</span>
 <input
 type="number"
 min={0}
 max={365}
 value={payRows[i]?.d ?? 0}
 onChange={(e) => patchPayRow(i, 'd', Math.max(0, Math.min(365, parseInt(e.target.value, 10) || 0)))}
 className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-gray-900"
 />
 <span className="text-gray-400">days</span>
 <input
 type="number"
 min={0}
 value={payRows[i]?.h ?? 0}
 onChange={(e) => patchPayRow(i, 'h', Math.max(0, parseInt(e.target.value, 10) || 0))}
 className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-gray-900"
 />
 <span className="text-gray-400">hours</span>
 <input
 type="number"
 min={0}
 max={59}
 value={payRows[i]?.m ?? 0}
 onChange={(e) => patchPayRow(i, 'm', Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
 className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-gray-900"
 />
 <span className="text-gray-400">min</span>
 </div>
 ))}
 </div>
 <button
 type="button"
 onClick={() => void savePaymentReminders()}
 disabled={paySaving}
 className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
 style={{ backgroundColor: '#1b1b1b' }}
 >
 {paySaving ? <Loader2 size={14} className="animate-spin"/> : paySaved ? <CheckCircle2 size={14} /> : <Save size={14} />}
 {paySaving ? 'Saving...' : paySaved ? 'Saved!' : 'Save payment reminders'}
 </button>
 </>
 )}
 </div>
 </div>

 {/* Save */}
 <div className="flex items-center gap-3">
 <button
 onClick={save}
 disabled={saving}
 className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
 style={{ backgroundColor: '#1b1b1b' }}
 >
 {saving ? <Loader2 size={14} className="animate-spin"/> : saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
 {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
 </button>
 {saved && <p className="text-sm text-emerald-600 font-medium">Notification preferences saved.</p>}
 </div>
 </div>
 </div>
 );
}
