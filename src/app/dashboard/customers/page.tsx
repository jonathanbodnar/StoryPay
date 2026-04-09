'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Search, UserPlus, X, Loader2, FileText, Receipt, ChevronLeft, ChevronRight, User } from 'lucide-react';

interface Customer {
  id: number;
  name: string;
  email: string;
  phone?: string;
}

const PAGE_SIZE = 20;

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
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const fetchCustomers = useCallback(async (q: string, p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(q)}&limit=${PAGE_SIZE + 1}&page=${p}`);
      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : data.data ?? [];
        setHasMore(items.length > PAGE_SIZE);
        setCustomers(items.slice(0, PAGE_SIZE));
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers('', 1);
  }, [fetchCustomers]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPage(1);
      fetchCustomers(search, 1);
    }, 400);
    return () => clearTimeout(timeout);
  }, [search, fetchCustomers]);

  function handlePageChange(newPage: number) {
    setPage(newPage);
    fetchCustomers(search, newPage);
  }

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
        fetchCustomers(search, page);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create customer');
      }
    } catch {
      setError('Network error - please try again');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Customers</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your customer database</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: '#1b1b1b' }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#333333')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1b1b1b')}
        >
          <UserPlus size={16} />
          Add Customer
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4 w-full max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or phone..."
          className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Name</th>
              <th className="hidden sm:table-cell px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Email</th>
              <th className="hidden md:table-cell px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Phone</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-gray-400">
                  <Loader2 className="inline animate-spin" size={18} />
                </td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-gray-400">
                  {search ? 'No customers match your search' : 'No customers yet'}
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50/50 transition-colors group">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/dashboard/customers/${c.id}`}
                      className="font-medium text-gray-900 hover:text-brand-900 hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="hidden sm:table-cell px-5 py-3.5 text-gray-700">{c.email || '---'}</td>
                  <td className="hidden md:table-cell px-5 py-3.5 text-gray-700">{c.phone || '---'}</td>
                  <td className="px-3 sm:px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1 flex-wrap">
                      <Link
                        href={`/dashboard/customers/${c.id}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                        title="View Customer"
                      >
                        <User size={13} />
                        <span className="hidden sm:inline">View Customer</span>
                      </Link>
                      <Link
                        href={`/dashboard/proposals/new?email=${encodeURIComponent(c.email || '')}&name=${encodeURIComponent(c.name || '')}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                        title="Create Proposal"
                      >
                        <FileText size={13} />
                        <span className="hidden lg:inline">Create Proposal</span>
                      </Link>
                      <Link
                        href={`/dashboard/invoices/new?email=${encodeURIComponent(c.email || '')}&name=${encodeURIComponent(c.name || '')}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                        title="Create Invoice"
                      >
                        <Receipt size={13} />
                        <span className="hidden lg:inline">Create Invoice</span>
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(page > 1 || hasMore) && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-gray-400">
            Page {page} {hasMore && '...'} 
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} />
              Previous
            </button>
            <button
              onClick={() => handlePageChange(page + 1)}
              disabled={!hasMore}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <button
              onClick={() => { setShowModal(false); setForm(emptyForm); setError(''); }}
              className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>

            <h2 className="font-heading text-lg font-semibold text-gray-900 mb-5">Add Customer</h2>

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">First Name *</label>
                  <input name="firstName" value={form.firstName} onChange={handleFormChange} required className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Last Name *</label>
                  <input name="lastName" value={form.lastName} onChange={handleFormChange} required className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Email *</label>
                <input name="email" type="email" value={form.email} onChange={handleFormChange} required className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Phone *</label>
                <input name="phone" type="tel" value={form.phone} onChange={handleFormChange} required placeholder="(555) 000-0000" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Address</label>
                <input name="address" value={form.address} onChange={handleFormChange} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">City</label>
                  <input name="city" value={form.city} onChange={handleFormChange} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">State</label>
                  <input name="state" value={form.state} onChange={handleFormChange} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Zip</label>
                  <input name="zip" value={form.zip} onChange={handleFormChange} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none" />
                </div>
              </div>

              {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setForm(emptyForm); setError(''); }}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#1b1b1b' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#333333')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1b1b1b')}
                >
                  {creating && <Loader2 size={16} className="animate-spin" />}
                  {creating ? 'Creating...' : 'Create Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
