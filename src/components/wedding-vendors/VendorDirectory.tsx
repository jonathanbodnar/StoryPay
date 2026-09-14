'use client';

import { useState } from 'react';
import { Plus, Trash2, Loader2, Check, AlertTriangle, Contact, Phone, Mail } from 'lucide-react';
import { useAutoSaveDoc } from '@/lib/use-auto-save-doc';
import {
  VENDOR_CATEGORIES,
  newVendorId,
  type VendorCategory,
  type VendorContact,
  type WeddingVendors,
} from '@/lib/wedding-vendors';

type SaveResult = { ok: boolean; conflict?: boolean; vendors?: WeddingVendors };

interface VendorDirectoryProps {
  initial: WeddingVendors;
  onSave: (next: WeddingVendors) => Promise<SaveResult>;
  audience?: 'couple' | 'venue';
}

const FIELD =
  'w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300';

export default function VendorDirectory({ initial, onSave, audience = 'couple' }: VendorDirectoryProps) {
  const { doc, update, saving, savedFlash, conflict, error } = useAutoSaveDoc<WeddingVendors>(
    initial,
    async (next) => {
      const res = await onSave(next);
      return { ok: res.ok, conflict: res.conflict, doc: res.vendors };
    },
  );

  const [addCategory, setAddCategory] = useState<VendorCategory>('Photographer');

  function addVendor() {
    const item: VendorContact = {
      id: newVendorId(),
      category: addCategory,
      businessName: '',
      contactName: '',
      phone: '',
      email: '',
      note: null,
    };
    // Add the blank row locally only — the server's tolerant reader strips
    // empty vendors, so we wait to persist until the couple fills a field in.
    update((prev) => ({ ...prev, items: [...prev.items, item] }), { save: false });
  }

  function patch(id: string, p: Partial<VendorContact>, immediate = false) {
    // Only persist once the row has something the server will keep — otherwise a
    // still-blank row (e.g. just picking a category) would be stripped on save
    // and vanish. The next edit that adds content saves the whole row.
    const current = doc.items.find((v) => v.id === id);
    const merged = { ...current, ...p } as VendorContact;
    const savable = Boolean(
      merged.businessName?.trim() ||
        merged.contactName?.trim() ||
        merged.phone?.trim() ||
        merged.email?.trim(),
    );
    update(
      (prev) => ({ ...prev, items: prev.items.map((v) => (v.id === id ? { ...v, ...p } : v)) }),
      savable ? { immediate } : { save: false },
    );
  }

  function remove(id: string) {
    update((prev) => ({ ...prev, items: prev.items.filter((v) => v.id !== id) }), { immediate: true });
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <Contact className="h-5 w-5 text-gray-400" />
          <p className="text-sm font-semibold text-gray-900">
            {doc.items.length} vendor{doc.items.length === 1 ? '' : 's'}
          </p>
        </div>
        <SaveStatus saving={saving} savedFlash={savedFlash} />
      </div>

      {conflict && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          {audience === 'venue' ? 'The couple' : 'Your venue'} updated the vendor list. We refreshed it — please re-apply your change.
        </div>
      )}
      {error && (
        <div className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {/* Add row */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <select
          value={addCategory}
          onChange={(e) => setAddCategory(e.target.value as VendorCategory)}
          style={{ accentColor: '#1b1b1b' }}
          className="rounded-lg border border-gray-200 px-2.5 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
        >
          {VENDOR_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addVendor}
          className="inline-flex items-center gap-1 rounded-xl bg-[#1b1b1b] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85"
        >
          <Plus className="h-4 w-4" /> Add vendor
        </button>
      </div>

      <ul className="divide-y divide-gray-100 border-t border-gray-100">
        {doc.items.map((v) => (
          <li key={v.id} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <select
                    value={v.category}
                    onChange={(e) => patch(v.id, { category: e.target.value as VendorCategory }, true)}
                    className="self-start rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
                  >
                    {VENDOR_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    value={v.businessName}
                    onChange={(e) => patch(v.id, { businessName: e.target.value })}
                    placeholder="Business name"
                    className="w-full min-w-0 border-none bg-transparent p-0 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-0 sm:w-auto sm:flex-1"
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    value={v.contactName}
                    onChange={(e) => patch(v.id, { contactName: e.target.value })}
                    placeholder="Contact name"
                    className={FIELD}
                  />
                  <input
                    value={v.phone}
                    onChange={(e) => patch(v.id, { phone: e.target.value })}
                    placeholder="Phone"
                    inputMode="tel"
                    className={FIELD}
                  />
                  <input
                    value={v.email}
                    onChange={(e) => patch(v.id, { email: e.target.value })}
                    placeholder="Email"
                    inputMode="email"
                    className={FIELD}
                  />
                </div>
                {(v.phone || v.email) && (
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    {v.phone && (
                      <a href={`tel:${v.phone}`} className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800">
                        <Phone className="h-3.5 w-3.5" /> Call
                      </a>
                    )}
                    {v.email && (
                      <a href={`mailto:${v.email}`} className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800">
                        <Mail className="h-3.5 w-3.5" /> Email
                      </a>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(v.id)}
                className="shrink-0 rounded-lg p-1.5 text-gray-300 hover:bg-gray-50 hover:text-red-500"
                aria-label="Remove vendor"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {doc.items.length === 0 && (
        <div className="px-4 py-8 text-center">
          <Contact className="mx-auto h-8 w-8 text-gray-200" />
          <p className="mt-2 text-sm text-gray-500">
            No vendors yet. Add your photographer, florist, DJ and more so everyone{' '}
            {audience === 'venue' ? 'on the team' : 'and your venue'} has the day-of contacts in one place.
          </p>
        </div>
      )}
    </div>
  );
}

function SaveStatus({ saving, savedFlash }: { saving: boolean; savedFlash: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-400">
      {saving ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
        </>
      ) : savedFlash ? (
        <span className="flex items-center gap-1 text-emerald-600">
          <Check className="h-3.5 w-3.5" /> Saved
        </span>
      ) : null}
    </div>
  );
}
