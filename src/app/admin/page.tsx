'use client';

import { useState, useEffect, useCallback } from 'react';

interface Venue {
  id: string;
  name: string;
  email: string | null;
  ghl_location_id: string | null;
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
  const [copiedGhl, setCopiedGhl] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    firstName: '',
    lastName: '',
    phone: '',
    ghlLocationId: '',
  });

  const [serverError, setServerError] = useState('');

  const fetchVenues = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/venues');
      if (res.status === 401) {
        setAuthState('unauthenticated');
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        let msg = 'Server error';
        try { msg = JSON.parse(text).error || msg; } catch { /* empty */ }
        setServerError(msg);
        setAuthState('authenticated');
        return;
      }
      const data = await res.json();
      setVenues(data.venues || []);
      setServerError('');
      setAuthState('authenticated');
    } catch (err) {
      console.error('fetchVenues error:', err);
      setServerError('Failed to connect to server');
      setAuthState('unauthenticated');
    }
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
    setServerError('');
    try {
      const res = await fetch('/api/admin/venues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setFormData({ name: '', email: '', firstName: '', lastName: '', phone: '', ghlLocationId: '' });
        setShowCreateForm(false);
        fetchVenues();
      } else {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        setServerError(data.error || `Create failed (${res.status})`);
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Request failed');
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
        <div className="animate-spin h-8 w-8 border-4 border-brand-800 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <form onSubmit={handleLogin} className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
          <h2 className="font-heading text-2xl text-brand-900 mb-6 text-center">Admin Login</h2>
          {loginError && (
            <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-2 mb-4">{loginError}</div>
          )}
          <label className="block text-sm font-medium text-gray-700 mb-1">Admin Secret</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-900 focus:border-brand-900 outline-none mb-4"
            placeholder="Enter admin secret..."
            required
          />
          <button
            type="submit"
            className="w-full bg-brand-900 hover:bg-brand-700 text-white font-medium py-2.5 rounded-lg transition-colors"
          >
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {serverError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <strong>Error:</strong> {serverError}
          <button onClick={fetchVenues} className="ml-3 underline">Retry</button>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-heading text-2xl text-brand-900">Wedding Venues</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="bg-brand-900 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {showCreateForm ? 'Cancel' : '+ Create Venue'}
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="font-heading text-lg text-brand-900 mb-4">New Venue</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-900 focus:border-brand-900 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner First Name *</label>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-900 focus:border-brand-900 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner Last Name *</label>
              <input
                type="text"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-900 focus:border-brand-900 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-900 focus:border-brand-900 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-900 focus:border-brand-900 outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">GHL Location ID</label>
              <input
                type="text"
                value={formData.ghlLocationId}
                onChange={(e) => setFormData({ ...formData, ghlLocationId: e.target.value })}
                placeholder="e.g. abc123XYZ..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-900 focus:border-brand-900 outline-none"
              />
              <p className="text-xs text-gray-400 mt-1">
                Optional. Enables auto-login from GHL dashboard via the universal link.
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={creating}
              className="bg-brand-900 hover:bg-brand-700 text-white font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Venue'}
            </button>
          </div>
        </form>
      )}

      <div className="mb-4 flex items-center justify-between rounded-lg border border-brand-900/20 bg-brand-900/5 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-brand-900">Universal GHL Login Link</p>
          <p className="text-xs text-brand-900 mt-0.5">
            Add this single link to GHL for all venues. It auto-detects the venue from the referring location.
          </p>
        </div>
        <button
          onClick={() => {
            const appUrl = venues[0]?.login_url?.split('/login/')[0] || 'https://www.storypay.io';
            navigator.clipboard.writeText(`${appUrl}/login/ghl`);
            setCopiedGhl(true);
            setTimeout(() => setCopiedGhl(false), 2000);
          }}
          className="shrink-0 ml-4 text-xs font-medium px-3 py-1.5 rounded-md bg-brand-700 text-white hover:bg-brand-700 transition-colors"
        >
          {copiedGhl ? 'Copied!' : 'Copy Link'}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Name</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Email</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">GHL Location</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Setup</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Created</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {venues.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-gray-400 py-12 text-sm">
                    No venues yet. Create one to get started.
                  </td>
                </tr>
              ) : (
                venues.map((venue) => (
                  <tr key={venue.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{venue.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{venue.email || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                      {venue.ghl_location_id
                        ? `${venue.ghl_location_id.slice(0, 12)}…`
                        : <span className="text-gray-300">—</span>}
                    </td>
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
