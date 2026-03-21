'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  PenLine,
  User,
  CalendarDays,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';

interface Field {
  id: string;
  field_type: 'signature' | 'name' | 'date';
  label: string;
  required: boolean;
}

interface Installment {
  id: string;
  amount: string;
  date: string;
}

const fieldTypeIcon: Record<string, typeof PenLine> = {
  signature: PenLine,
  name: User,
  date: CalendarDays,
};

const fieldTypeLabel: Record<string, string> = {
  signature: 'Signature',
  name: 'Name',
  date: 'Date',
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [priceDollars, setPriceDollars] = useState('');
  const [paymentType, setPaymentType] = useState<'full' | 'installment' | 'subscription'>('full');

  const [installments, setInstallments] = useState<Installment[]>([]);
  const [subAmount, setSubAmount] = useState('');
  const [subFrequency, setSubFrequency] = useState<'monthly' | 'weekly'>('monthly');
  const [subStartDate, setSubStartDate] = useState('');

  const [fields, setFields] = useState<Field[]>([]);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/templates/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setName(data.name ?? '');
        setContent(data.content ?? '');
        setPriceDollars(data.price ? (data.price / 100).toFixed(2) : '');
        setPaymentType(data.payment_type ?? 'full');

        const cfg = data.payment_config ?? {};
        if (data.payment_type === 'installment' && cfg.installments) {
          setInstallments(
            cfg.installments.map((i: { amount: number; date: string }) => ({
              id: uid(),
              amount: (i.amount / 100).toFixed(2),
              date: i.date ?? '',
            }))
          );
        }
        if (data.payment_type === 'subscription') {
          setSubAmount(cfg.amount ? (cfg.amount / 100).toFixed(2) : '');
          setSubFrequency(cfg.frequency ?? 'monthly');
          setSubStartDate(cfg.start_date ?? '');
        }

        setFields(
          (data.fields ?? []).map((f: { id: string; field_type: string; label: string; required: boolean }) => ({
            id: f.id ?? uid(),
            field_type: f.field_type as Field['field_type'],
            label: f.label ?? '',
            required: f.required ?? true,
          }))
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  function addField(type: Field['field_type']) {
    setFields((prev) => [
      ...prev,
      { id: uid(), field_type: type, label: fieldTypeLabel[type], required: true },
    ]);
    setFieldMenuOpen(false);
  }

  function updateField(fieldId: string, updates: Partial<Field>) {
    setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, ...updates } : f)));
  }

  function removeField(fieldId: string) {
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
  }

  function moveField(idx: number, dir: -1 | 1) {
    setFields((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function addInstallment() {
    setInstallments((prev) => [...prev, { id: uid(), amount: '', date: '' }]);
  }

  function updateInstallment(instId: string, updates: Partial<Installment>) {
    setInstallments((prev) => prev.map((i) => (i.id === instId ? { ...i, ...updates } : i)));
  }

  function removeInstallment(instId: string) {
    setInstallments((prev) => prev.filter((i) => i.id !== instId));
  }

  function buildPaymentConfig() {
    if (paymentType === 'installment') {
      return {
        installments: installments.map((i) => ({
          amount: Math.round(parseFloat(i.amount || '0') * 100),
          date: i.date,
        })),
      };
    }
    if (paymentType === 'subscription') {
      return {
        amount: Math.round(parseFloat(subAmount || '0') * 100),
        frequency: subFrequency,
        start_date: subStartDate,
      };
    }
    return {};
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          content,
          price: Math.round(parseFloat(priceDollars || '0') * 100),
          payment_type: paymentType,
          payment_config: buildPaymentConfig(),
          fields: fields.map((f, i) => ({
            field_type: f.field_type,
            label: f.label,
            required: f.required,
            sort_order: i,
          })),
        }),
      });

      if (res.ok) {
        router.push('/dashboard/proposals/templates');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/dashboard/proposals/templates');
      }
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link
        href="/dashboard/proposals/templates"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Templates
      </Link>
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900">Edit Template</h1>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={12} />
            Delete Template
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-600">Are you sure?</span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
            >
              {deleting ? 'Deleting…' : 'Yes, Delete'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="space-y-8">
        {/* Template Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Template Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Premium Wedding Package"
            className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
          />
        </div>

        {/* Content */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Proposal Content
          </label>
          <p className="text-xs text-gray-400 mb-1.5">
            Body text and terms for the proposal. HTML is supported.
          </p>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            placeholder="Enter proposal body, terms & conditions…"
            className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition resize-y"
          />
        </div>

        {/* Price */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Total Price</label>
          <div className="relative w-48">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
            />
          </div>
        </div>

        {/* Payment Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Payment Type</label>
          <div className="flex gap-2">
            {(['full', 'installment', 'subscription'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setPaymentType(type)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  paymentType === type
                    ? 'border-teal-500 bg-teal-50 text-teal-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {type === 'full' ? 'Full Payment' : type === 'installment' ? 'Installment Plan' : 'Subscription'}
              </button>
            ))}
          </div>
        </div>

        {/* Payment Config - Installment */}
        {paymentType === 'installment' && (
          <div className="rounded-lg border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Installment Schedule</h3>
            <div className="space-y-3">
              {installments.map((inst) => (
                <div key={inst.id} className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={inst.amount}
                      onChange={(e) => updateInstallment(inst.id, { amount: e.target.value })}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
                    />
                  </div>
                  <input
                    type="date"
                    value={inst.date}
                    onChange={(e) => updateInstallment(inst.id, { date: e.target.value })}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => removeInstallment(inst.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addInstallment}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
            >
              <Plus size={14} />
              Add Payment
            </button>
          </div>
        )}

        {/* Payment Config - Subscription */}
        {paymentType === 'subscription' && (
          <div className="rounded-lg border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Subscription Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount per Period</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={subAmount}
                    onChange={(e) => setSubAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Frequency</label>
                <select
                  value={subFrequency}
                  onChange={(e) => setSubFrequency(e.target.value as 'monthly' | 'weekly')}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                <input
                  type="date"
                  value={subStartDate}
                  onChange={(e) => setSubStartDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
                />
              </div>
            </div>
          </div>
        )}

        {/* Signature Fields */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-gray-700">Signature Fields</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setFieldMenuOpen(!fieldMenuOpen)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Plus size={12} />
                Add Field
              </button>
              {fieldMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-10 w-40 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
                  {(['signature', 'name', 'date'] as const).map((type) => {
                    const Icon = fieldTypeIcon[type];
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => addField(type)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Icon size={14} className="text-gray-400" />
                        {fieldTypeLabel[type]}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {fields.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded-lg">
              No fields added yet.
            </p>
          ) : (
            <div className="space-y-2">
              {fields.map((field, idx) => {
                const Icon = fieldTypeIcon[field.field_type];
                return (
                  <div
                    key={field.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveField(idx, -1)}
                        disabled={idx === 0}
                        className="text-gray-300 hover:text-gray-500 disabled:opacity-30"
                      >
                        <GripVertical size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveField(idx, 1)}
                        disabled={idx === fields.length - 1}
                        className="text-gray-300 hover:text-gray-500 disabled:opacity-30"
                      >
                        <GripVertical size={14} />
                      </button>
                    </div>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100">
                      <Icon size={14} className="text-gray-500" />
                    </div>
                    <input
                      type="text"
                      value={field.label}
                      onChange={(e) => updateField(field.id, { label: e.target.value })}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(field.id, { required: e.target.checked })}
                        className="rounded border-gray-300 text-teal-500 focus:ring-teal-500/20"
                      />
                      Required
                    </label>
                    <button
                      type="button"
                      onClick={() => removeField(field.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Save */}
        <div className="pt-4 border-t border-gray-100">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="rounded-lg bg-teal-500 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </div>
    </div>
  );
}
