'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, CheckCircle2, User } from 'lucide-react';

interface Profile {
 id: string;
 first_name: string;
 last_name: string;
 email: string;
 role: string;
 status: string;
}

const INPUT = 'w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';
const LABEL = 'block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide';

export default function ProfilePage() {
 const [profile, setProfile] = useState<Profile | null>(null);
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [saved, setSaved] = useState(false);
 const [error, setError] = useState('');
 const [memberId, setMemberId] = useState<string | null>(null);

 const [form, setForm] = useState({
 first_name: '', last_name: '', email: '',
 });

 useEffect(() => {
 async function load() {
 try {
 const sessionRes = await fetch('/api/session/me', { cache: 'no-store' });
 if (!sessionRes.ok) return;
 const session = await sessionRes.json();

 if (!session.memberId) {
 // Owner — no profile page needed, redirect to settings
 window.location.href = '/dashboard/settings';
 return;
 }

 setMemberId(session.memberId);

 // Load team member data
 const teamRes = await fetch('/api/team', { cache: 'no-store' });
 if (teamRes.ok) {
 const members = await teamRes.json();
 const me = members.find((m: Profile) => m.id === session.memberId);
 if (me) {
 setProfile(me);
 setForm({ first_name: me.first_name || '', last_name: me.last_name || '', email: me.email || '' });
 }
 }
 } finally {
 setLoading(false);
 }
 }
 load();
 }, []);

 async function save(e: React.FormEvent) {
 e.preventDefault();
 if (!memberId) return;
 setSaving(true);
 setError('');
 try {
 const res = await fetch(`/api/team/${memberId}`, {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(form),
 });
 const data = await res.json();
 if (!res.ok) { setError(data.error || 'Failed to save'); return; }
 setProfile(data);
 setSaved(true);
 setTimeout(() => setSaved(false), 3000);
 } catch { setError('Network error — please try again'); }
 finally { setSaving(false); }
 }

 if (loading) return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400"/></div>;
 if (!profile) return <div className="py-20 text-center text-gray-500">Profile not found.</div>;

 const roleLabel = profile.role === 'admin' ? 'Admin' : profile.role === 'owner' ? 'Owner' : 'Member';

 return (
 <div className="max-w-lg">
 <div className="mb-8">
 <div className="flex items-center gap-3 mb-1">
 <User size={22} className="text-gray-700"/>
 <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
 </div>
 <p className="text-sm text-gray-500 ml-9">Update your name and contact details</p>
 </div>

 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-xl">
 <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
 <div>
 <p className="text-sm font-semibold text-gray-900">
 {[profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Team Member'}
 </p>
 <p className="text-xs text-gray-400 mt-0.5">{roleLabel} · {profile.status}</p>
 </div>
 <div className="flex h-11 w-11 items-center justify-center rounded-full text-white text-base font-bold"
 style={{ backgroundColor: '#1b1b1b' }}>
 {(profile.first_name?.[0] || '?').toUpperCase()}
 </div>
 </div>

 <form onSubmit={save} className="px-6 py-5 space-y-4">
 <div className="grid grid-cols-2 gap-4">
 <div>
 <label className={LABEL}>First Name <span className="text-red-400">*</span></label>
 <input type="text"required value={form.first_name}
 onChange={e => setForm(p => ({ ...p, first_name: e.target.value }))}
 className={INPUT} />
 </div>
 <div>
 <label className={LABEL}>Last Name</label>
 <input type="text"value={form.last_name}
 onChange={e => setForm(p => ({ ...p, last_name: e.target.value }))}
 className={INPUT} />
 </div>
 </div>
 <div>
 <label className={LABEL}>Email <span className="text-red-400">*</span></label>
 <input type="email"required value={form.email}
 onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
 className={INPUT} />
 </div>

 {error && <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

 <div className="flex items-center justify-between pt-1">
 {saved && (
 <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
 <CheckCircle2 size={15} /> Saved!
 </div>
 )}
 <button
 type="submit"
 disabled={saving}
 className="ml-auto flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
 style={{ backgroundColor: '#1b1b1b' }}
 >
 {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14} />}
 {saving ? 'Saving...' : 'Save Profile'}
 </button>
 </div>
 </form>
 </div>
 </div>
 );
}
