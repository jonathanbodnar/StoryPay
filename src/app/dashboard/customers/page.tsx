'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Search, UserPlus, X, Loader2 } from 'lucide-react';

interface Customer {
  id: number;
  name: string;
  email: string;
  phone?: string;
  proposalCount?: number;
}

const emptyForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  zip: '',
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const fetchCustomers = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(q)}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setCustomers(Array.isArray(data) ? data : data.data ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers('');
  }, [fetchCustomers]);

  useEffect(() => {
    const timeout = setTimeout(() => fetchCustomers(search), 400);
    return () => clearTimeout(timeout);
  }, [search, fetchCustomers]);

  function handleFormChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email) return;

    setCreating(true);
    setError('');

    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (res.ok) {
        setShowModal(false);
        setForm(emptyForm);
        fetchCustomers(search);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create customer');
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-gray-900">Customers</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your customer database</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          <UserPlus size={16} />
          Add Customer
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customers…"
          className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Name
              </th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Email
              </th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Phone
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-5 py-8 text-center text-gray-400">
                  <Loader2 className="inline animate-spin" size={18} />
                </td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-5 py-8 text-center text-gray-400">
                  {search ? 'No customers match your search' : 'No customers yet'}
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/dashboard/customers/${c.id}`}
                      className="font-medium text-gray-900 hover:text-brand-900 hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-gray-700">{c.email || '---'}</td>
                  <td className="px-5 py-3.5 text-gray-700">{c.phone || '---'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Customer Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <button
              onClick={() => {
                setShowModal(false);
                setForm(emptyForm);
                setError('');
              }}
              className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>

            <h2 className="font-heading text-lg font-semibold text-gray-900 mb-5">
              Add Customer
            </h2>

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    First Name *
                  </label>
                  <input
                    name="firstName"
                    value={form.firstName}
                    onChange={handleFormChange}
                    required
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    Last Name *
                  </label>
                  <input
                    name="lastName"
                    value={form.lastName}
                    onChange={handleFormChange}
                    required
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Email *
                </label>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleFormChange}
                  required
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Phone
                </label>
                <input
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={handleFormChange}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Address
                </label>
                <input
                  name="address"
                  value={form.address}
                  onChange={handleFormChange}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    City
                  </label>
                  <input
                    name="city"
                    value={form.city}
                    onChange={handleFormChange}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    State
                  </label>
                  <input
                    name="state"
                    value={form.state}
                    onChange={handleFormChange}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    Zip
                  </label>
                  <input
                    name="zip"
                    value={form.zip}
                    onChange={handleFormChange}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setForm(emptyForm);
                    setError('');
                  }}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex items-center gap-2 rounded-lg bg-brand-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                >
                  {creating && <Loader2 size={16} className="animate-spin" />}
                  {creating ? 'Creating…' : 'Create Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
