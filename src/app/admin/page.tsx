'use client';

import { useState, useEffect, useCallback } from 'react';

interface Venue {
  id: string;
  name: string;
  email: string | null;
  onboarding_status: string;
  setup_completed: boolean;
  created_at: string;
  login_url: string | null;
  venue_tokens: { token: string }[];
}

type AuthState = 'loading' | 'unauthenticated' | 'authenticated';

export default function AdminPage() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [secret, setSecret] = useState('');
  const [loginError, setLoginError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    lunarpay_secret_key: '',
    lunarpay_publishable_key: '',
    lunarpay_org_token: '',
  });

  const fetchVenues = useCallback(async () => {
    const res = await fetch('/api/admin/venues');
    if (res.status === 401) {
      setAuthState('unauthenticated');
      return;
    }
    const data = await res.json();
    setVenues(data.venues || []);
    setAuthState('authenticated');
  }, []);

  useEffect(() => {
    fetchVenues();
  }, [fetchVenues]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    });
    if (!res.ok) {
      setLoginError('Invalid secret');
      return;
    }
    setSecret('');
    fetchVenues();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch('/api/admin/venues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    if (res.ok) {
      setFormData({ name: '', email: '', lunarpay_secret_key: '', lunarpay_publishable_key: '', lunarpay_org_token: '' });
      setShowCreateForm(false);
      fetchVenues();
    }
    setCreating(false);
  }

  function copyLoginLink(venue: Venue) {
    if (!venue.login_url) return;
    navigator.clipboard.writeText(venue.login_url);
    setCopiedId(venue.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function statusBadge(status: string) {
    const styles: Record<string, string> = {
      active: 'bg-emerald-100 text-emerald-800',
      pending: 'bg-amber-100 text-amber-800',
      bank_information_sent: 'bg-blue-100 text-blue-800',
    };
    const labels: Record<string, string> = {
      active: 'Active',
      pending: 'Pending',
      bank_information_sent: 'Bank Info Sent',
    };
    return (
      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
        {labels[status] || status}
      </span>
    );
  }

  if (authState === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-4 border-navy-800 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <form onSubmit={handleLogin} className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
          <h2 className="font-heading text-2xl text-navy-900 mb-6 text-center">Admin Login</h2>
          {loginError && (
            <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-2 mb-4">{loginError}</div>
          )}
          <label className="block text-sm font-medium text-gray-700 mb-1">Admin Secret</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-navy-600 focus:border-navy-600 outline-none mb-4"
            placeholder="Enter admin secret..."
            required
          />
          <button
            type="submit"
            className="w-full bg-navy-900 hover:bg-navy-800 text-white font-medium py-2.5 rounded-lg transition-colors"
          >
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-heading text-2xl text-navy-900">Wedding Venues</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="bg-navy-900 hover:bg-navy-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {showCreateForm ? 'Cancel' : '+ Create Venue'}
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="font-heading text-lg text-navy-900 mb-4">New Venue</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Venue Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-navy-600 focus:border-navy-600 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-navy-600 focus:border-navy-600 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">LunarPay Secret Key</label>
              <input
                type="text"
                value={formData.lunarpay_secret_key}
                onChange={(e) => setFormData({ ...formData, lunarpay_secret_key: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-navy-600 focus:border-navy-600 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">LunarPay Publishable Key</label>
              <input
                type="text"
                value={formData.lunarpay_publishable_key}
                onChange={(e) => setFormData({ ...formData, lunarpay_publishable_key: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-navy-600 focus:border-navy-600 outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">LunarPay Org Token</label>
              <input
                type="text"
                value={formData.lunarpay_org_token}
                onChange={(e) => setFormData({ ...formData, lunarpay_org_token: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-navy-600 focus:border-navy-600 outline-none"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={creating}
              className="bg-teal-500 hover:bg-teal-600 text-white font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Venue'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Name</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Email</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Setup</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Created</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {venues.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-gray-400 py-12 text-sm">
                    No venues yet. Create one to get started.
                  </td>
                </tr>
              ) : (
                venues.map((venue) => (
                  <tr key={venue.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{venue.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{venue.email || '—'}</td>
                    <td className="px-4 py-3">{statusBadge(venue.onboarding_status)}</td>
                    <td className="px-4 py-3">
                      {venue.setup_completed ? (
                        <span className="inline-block h-5 w-5 rounded-full bg-emerald-100 text-emerald-600 text-center text-xs leading-5">✓</span>
                      ) : (
                        <span className="inline-block h-5 w-5 rounded-full bg-gray-100 text-gray-400 text-center text-xs leading-5">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(venue.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => copyLoginLink(venue)}
                        disabled={!venue.login_url}
                        className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {copiedId === venue.id ? 'Copied!' : 'Copy Login Link'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
