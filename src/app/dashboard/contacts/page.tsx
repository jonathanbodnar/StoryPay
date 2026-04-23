'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Search,
  UserPlus,
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
import AddLeadModal, {
  type LeadDraft,
  type LeadPipeline,
  type MarketingTag,
  type VenueSpaceLite,
} from '@/components/leads/AddLeadModal';

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

  // Shared state for the unified add modal (mirrors the Leads page).
  const [pipelines, setPipelines] = useState<LeadPipeline[]>([]);
  const [defaultPipelineId, setDefaultPipelineId] = useState<string>('');
  const [spaces, setSpaces] = useState<VenueSpaceLite[]>([]);
  const [tags, setTags] = useState<MarketingTag[]>([]);

  const loadModalData = useCallback(async () => {
    const [pipeRes, spaceRes, tagRes] = await Promise.all([
      fetch('/api/pipelines', { cache: 'no-store' }).catch(() => null),
      fetch('/api/spaces', { cache: 'no-store' }).catch(() => null),
      fetch('/api/marketing/tags', { cache: 'no-store' }).catch(() => null),
    ]);
    if (pipeRes?.ok) {
      const d = (await pipeRes.json().catch(() => ({}))) as {
        pipelines?: LeadPipeline[];
      };
      const list = Array.isArray(d.pipelines) ? d.pipelines : [];
      setPipelines(list);
      const def = list.find((p) => p.is_default) || list[0];
      if (def) setDefaultPipelineId(def.id);
    }
    if (spaceRes?.ok) {
      const rows = (await spaceRes.json().catch(() => [])) as VenueSpaceLite[];
      setSpaces(Array.isArray(rows) ? rows : []);
    }
    if (tagRes?.ok) {
      const d = (await tagRes.json().catch(() => ({}))) as { tags?: MarketingTag[] };
      setTags(Array.isArray(d.tags) ? d.tags : []);
    }
  }, []);

  useEffect(() => {
    void loadModalData();
  }, [loadModalData]);

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
        <AddLeadModal
          title="New contact"
          submitLabel="Create contact"
          pipelines={pipelines}
          allTags={tags}
          spaces={spaces}
          onSpacesChange={setSpaces}
          defaultPipelineId={defaultPipelineId}
          onClose={() => setShowModal(false)}
          onSave={async (draft) => {
            await createContactFromDraft(draft);
            setShowModal(false);
            await Promise.all([fetchContacts(search, page), loadModalData()]);
          }}
          onVenueTagCreated={(tag) =>
            setTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]))
          }
        />
      )}
    </div>
  );
}

async function createContactFromDraft(draft: LeadDraft) {
  const payload = {
    firstName: draft.firstName,
    lastName: draft.lastName,
    email: draft.email,
    phone: draft.phone,
    venueName: draft.venueName,
    venueWebsiteUrl: draft.venueWebsiteUrl,
    opportunityValue: draft.opportunityValue ? Number(draft.opportunityValue) : null,
    weddingDate: draft.weddingDate || null,
    guestCount: draft.guestCount ? Number(draft.guestCount) : null,
    bookingTimeline: draft.bookingTimeline.trim() || undefined,
    message: draft.message,
    pipelineId: draft.pipelineId || undefined,
    stageId: draft.stageId || undefined,
    spaceId: draft.spaceId || null,
    tagIds: draft.tagIds,
  };
  const res = await fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data && typeof data.error === 'string' && data.error) || 'Failed to create contact');
  }
}

