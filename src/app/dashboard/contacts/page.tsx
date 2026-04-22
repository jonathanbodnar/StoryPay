'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Search,
  UserPlus,
  X,
  Loader2,
  FileText,
  Receipt,
  ChevronLeft,
  ChevronRight,
  User,
  Download,
  Upload,
} from 'lucide-react';
import { classNames } from '@/lib/utils';

const capitalizeName = (name: string) => name.replace(/\b\w/g, (c) => c.toUpperCase());

interface ContactRow {
  id: string | number;
  name: string;
  email: string;
  phone?: string;
  funnelStage?: string | null;
  funnelStageColor?: string | null;
  venueCustomerId?: string | null;
}

const PAGE_SIZE = 20;

type ContactForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

const emptyForm: ContactForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  zip: '',
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

  const fetchContacts = useCallback(async (q: string, p: number) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/customers?search=${encodeURIComponent(q)}&limit=${PAGE_SIZE + 1}&page=${p}`,
      );
      if (res.ok) {
        const data = await res.json();
        const items = (Array.isArray(data) ? data : data.data ?? []) as ContactRow[];
        setHasMore(items.length > PAGE_SIZE);
        setContacts(items.slice(0, PAGE_SIZE));
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts('', 1);
  }, [fetchContacts]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPage(1);
      fetchContacts(search, 1);
    }, 400);
    return () => clearTimeout(timeout);
  }, [search, fetchContacts]);

  function handlePageChange(newPage: number) {
    setPage(newPage);
    fetchContacts(search, newPage);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImportBusy(true);
    setImportMessage('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/contacts/import', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        imported?: number;
        skippedInvalid?: number;
      };
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setImportMessage(
        `Imported ${data.imported ?? 0} contact(s).${
          data.skippedInvalid ? ` Skipped ${data.skippedInvalid} invalid row(s).` : ''
        }`,
      );
      fetchContacts(search, page);
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportBusy(false);
    }
  }

  const exportHref = `/api/contacts/export?search=${encodeURIComponent(search)}`;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Contacts</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your contact list</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            type="button"
            disabled={importBusy}
            onClick={() => importInputRef.current?.click()}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {importBusy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            Import CSV
          </button>
          <a
            href={exportHref}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50"
          >
            <Download size={16} />
            Export CSV
          </a>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: '#1b1b1b' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#333333')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1b1b1b')}
          >
            <UserPlus size={16} />
            Add contact
          </button>
        </div>
      </div>

      {importMessage && (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm ${
            importMessage.startsWith('Imported') ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {importMessage}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4 w-full max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or phone..."
          autoComplete="off"
          style={{ fontSize: 16 }}
          className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:ring-1 focus:ring-brand-900 outline-none"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-gray-200">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Name
              </th>
              <th className="hidden sm:table-cell px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Email
              </th>
              <th className="hidden md:table-cell px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Phone
              </th>
              <th className="hidden md:table-cell px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Status
              </th>
              <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-gray-400">
                  <Loader2 className="inline animate-spin" size={18} />
                </td>
              </tr>
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-gray-400">
                  {search ? 'No contacts match your search' : 'No contacts yet'}
                </td>
              </tr>
            ) : (
              contacts.map((c) => (
                <tr key={String(c.id)} className="group hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/dashboard/contacts/${encodeURIComponent(String(c.id))}`}
                      className="font-medium text-gray-900 hover:text-brand-900 hover:underline"
                    >
                      {capitalizeName(c.name || '')}
                    </Link>
                  </td>
                  <td className="hidden sm:table-cell px-5 py-3.5 text-gray-700">{c.email || '---'}</td>
                  <td className="hidden md:table-cell px-5 py-3.5 text-gray-700">{c.phone || '---'}</td>
                  <td className="hidden md:table-cell px-5 py-3.5">
                    {c.funnelStage ? (
                      <span
                        className={classNames(
                          'inline-flex max-w-[160px] truncate rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
                          !c.funnelStageColor && 'border-gray-200 bg-gray-50 text-gray-700',
                        )}
                        style={
                          c.funnelStageColor
                            ? {
                                backgroundColor: `${c.funnelStageColor}22`,
                                color: c.funnelStageColor,
                                borderColor: `${c.funnelStageColor}44`,
                              }
                            : undefined
                        }
                        title={c.funnelStage}
                      >
                        {c.funnelStage}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 sm:px-5 py-3.5 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <Link
                        href={`/dashboard/contacts/${encodeURIComponent(String(c.id))}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                        title="View contact"
                      >
                        <User size={13} />
                        <span className="hidden sm:inline">View</span>
                      </Link>
                      <Link
                        href={`/dashboard/payments/new?type=proposal&email=${encodeURIComponent(c.email || '')}&name=${encodeURIComponent(c.name || '')}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                        title="Create Proposal"
                      >
                        <FileText size={13} />
                        <span className="hidden lg:inline">Create Proposal</span>
                      </Link>
                      <Link
                        href={`/dashboard/payments/new?type=invoice&email=${encodeURIComponent(c.email || '')}&name=${encodeURIComponent(c.name || '')}`}
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
              type="button"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={14} />
              Previous
            </button>
            <button
              type="button"
              onClick={() => handlePageChange(page + 1)}
              disabled={!hasMore}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <AddContactModal
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            fetchContacts(search, page);
          }}
        />
      )}
    </div>
  );
}

// ─── Add contact modal ───────────────────────────────────────────────────────
// Mirrors the "New lead" modal on the Leads page: full-screen overlay, a
// rounded-3xl card with a scrollable body, uppercase-tracked labels, and
// the brand-color footer button. Required fields are name (first OR last),
// email, and phone — matching the leads form.

function AddContactModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof ContactForm>(key: K, value: ContactForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function submit() {
    const hasName = form.firstName.trim() !== '' || form.lastName.trim() !== '';
    if (!hasName) {
      setError('Please provide at least a first or last name.');
      return;
    }
    if (!form.email.trim()) {
      setError('Email is required.');
      return;
    }
    if (!form.phone.trim()) {
      setError('Phone is required.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data && typeof data.error === 'string' && data.error) || 'Failed to create contact.');
        return;
      }
      onSaved();
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative w-full max-w-2xl max-h-[90vh] rounded-3xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="font-heading text-lg text-gray-900 flex items-center gap-2">
              <UserPlus className="w-4.5 h-4.5" /> New contact
            </h3>
            <button
              onClick={onClose}
              className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-6 overflow-y-auto space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <ContactField label="First name" value={form.firstName} onChange={(v) => set('firstName', v)} />
              <ContactField label="Last name" value={form.lastName} onChange={(v) => set('lastName', v)} />
            </div>
            <ContactField
              label="Email"
              value={form.email}
              type="email"
              required
              onChange={(v) => set('email', v)}
            />
            <ContactField
              label="Phone"
              value={form.phone}
              type="tel"
              required
              placeholder="(555) 000-0000"
              onChange={(v) => set('phone', v)}
            />
            <ContactField label="Address" value={form.address} onChange={(v) => set('address', v)} />
            <div className="grid grid-cols-3 gap-3">
              <ContactField label="City" value={form.city} onChange={(v) => set('city', v)} />
              <ContactField label="State" value={form.state} onChange={(v) => set('state', v)} />
              <ContactField label="Zip" value={form.zip} onChange={(v) => set('zip', v)} />
            </div>

            {error && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
            <button
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: '#1b1b1b' }}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create contact
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactField({
  label,
  value,
  onChange,
  type = 'text',
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
        {label}
        {required ? ' *' : ''}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
      />
    </div>
  );
}
