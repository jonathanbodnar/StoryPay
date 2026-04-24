'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlignCenter, AlignLeft, AlignRight, ArrowLeft, Check,
  ChevronDown, ChevronRight, ChevronUp, Copy, Image as ImageIcon,
  Loader2, Minus, Plus, SeparatorHorizontal, Space, Trash2, Type,
  MousePointer2, Palette, Video, Share2, MapPin,
} from 'lucide-react';
import { VenueMediaPickerModal } from '@/components/venue-media/VenueMediaPickerModal';
import RichTextEditor from '@/components/RichTextEditor';
import {
  type EmailBlock,
  type EmailBlockType,
  type MarketingEmailDefinition,
  type EmailTheme,
  createEmailBlock,
  mergeEmailTheme,
} from '@/lib/marketing-email-schema';

// ─── Block palette shown in the picker ───────────────────────────────────────
const PALETTE: { type: EmailBlockType; label: string; desc: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
  { type: 'heading', label: 'Heading',      desc: 'Title or section header',     Icon: Type },
  { type: 'text',    label: 'Text',         desc: 'Body copy or paragraphs',     Icon: AlignLeft },
  { type: 'button',  label: 'Button',       desc: 'Call-to-action link',         Icon: MousePointer2 },
  { type: 'image',   label: 'Image',        desc: 'Photo or graphic',            Icon: ImageIcon },
  { type: 'video',   label: 'Video',        desc: 'Video with outbound link',    Icon: Video },
  { type: 'social',  label: 'Social Links', desc: 'Facebook, Instagram & more',  Icon: Share2 },
  { type: 'address', label: 'Address',      desc: 'Your venue business address', Icon: MapPin },
  { type: 'divider', label: 'Divider',      desc: 'Horizontal rule',             Icon: SeparatorHorizontal },
  { type: 'spacer',  label: 'Spacer',       desc: 'Vertical whitespace',         Icon: Space },
];

// ─── Social platform definitions ─────────────────────────────────────────────
const SOCIAL_PLATFORMS = [
  { id: 'facebook',  label: 'Facebook',    color: '#1877F2', abbr: 'f' },
  { id: 'instagram', label: 'Instagram',   color: '#E1306C', abbr: 'ig' },
  { id: 'youtube',   label: 'YouTube',     color: '#FF0000', abbr: 'yt' },
  { id: 'tiktok',    label: 'TikTok',      color: '#010101', abbr: 'tt' },
  { id: 'pinterest', label: 'Pinterest',   color: '#E60023', abbr: 'p' },
  { id: 'linkedin',  label: 'LinkedIn',    color: '#0A66C2', abbr: 'in' },
  { id: 'twitter',   label: 'X / Twitter', color: '#000000', abbr: 'X' },
] as const;

// ─── Venue address type (passed from server page) ─────────────────────────────
type VenueAddress = {
  name: string;
  location_full?: string | null;
  location_city?: string | null;
  location_state?: string | null;
};

// ─── Types ────────────────────────────────────────────────────────────────────
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function moveArr<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const a = [...arr];
  const [item] = a.splice(from, 1);
  a.splice(to, 0, item);
  return a;
}

function stripTags(s: string) { return s.replace(/<[^>]+>/g, '').trim(); }

// ─── Individual block canvas renderers ───────────────────────────────────────
function HeadingCanvas({ block, theme }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme> }) {
  const sizes: Record<number, string> = { 1: '28px', 2: '22px', 3: '18px' };
  const size = sizes[block.level ?? 2] ?? '22px';
  const text = stripTags(block.content || '') || 'Heading text';
  return (
    <div style={{
      padding: '8px 24px',
      textAlign: block.align ?? 'left',
      fontFamily: theme.fontFamily,
      fontSize: size,
      fontWeight: 700,
      color: theme.textColor,
      lineHeight: 1.25,
      wordBreak: 'break-word',
    }}>
      {text}
    </div>
  );
}

function TextCanvas({ block, theme }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme> }) {
  const html = block.content || '<p>Your message here.</p>';
  return (
    <div style={{
      padding: '8px 24px',
      textAlign: block.align ?? 'left',
      fontFamily: theme.fontFamily,
      fontSize: '16px',
      lineHeight: 1.6,
      color: theme.textColor,
    }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ButtonCanvas({ block, theme }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme> }) {
  const label = block.buttonLabel?.trim() || 'Click here';
  return (
    <div style={{ padding: '16px 24px', textAlign: block.align ?? 'center' }}>
      <span style={{
        display: 'inline-block',
        background: theme.buttonBg,
        color: theme.buttonText,
        padding: '14px 28px',
        borderRadius: '8px',
        fontWeight: 600,
        fontSize: '16px',
        fontFamily: 'sans-serif',
        cursor: 'default',
      }}>
        {label}
      </span>
    </div>
  );
}

function ImageCanvas({ block, theme }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme> }) {
  if (!block.src?.trim()) {
    return (
      <div style={{ padding: '16px 24px', textAlign: 'center' }}>
        <div style={{
          border: `2px dashed ${theme.mutedColor}`,
          borderRadius: '8px',
          padding: '32px',
          color: theme.mutedColor,
          fontSize: '14px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
        }}>
          <ImageIcon size={28} />
          <span>Add image URL in the panel →</span>
        </div>
      </div>
    );
  }
  return (
    <div style={{ padding: '8px 24px', textAlign: block.align ?? 'center' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={block.src} alt={block.alt ?? ''} style={{ maxWidth: '100%', height: 'auto', display: 'inline-block', borderRadius: '4px' }} />
    </div>
  );
}

function DividerCanvas({ theme }: { theme: ReturnType<typeof mergeEmailTheme> }) {
  return (
    <div style={{ padding: '12px 24px' }}>
      <hr style={{ border: 'none', borderTop: `1px solid ${theme.mutedColor}`, margin: 0 }} />
    </div>
  );
}

function SpacerCanvas({ block }: { block: EmailBlock }) {
  const h = block.spacerHeight ?? 24;
  return (
    <div style={{ height: `${h}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: '11px', color: '#d1d5db', userSelect: 'none' }}>{h}px</span>
    </div>
  );
}

function VideoCanvas({ block, theme }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme> }) {
  const hasThumbnail = !!block.src?.trim();
  return (
    <div style={{ padding: '16px 24px' }}>
      <div style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', background: '#18181b', cursor: 'default' }}>
        {hasThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.src} alt="Video thumbnail" style={{ width: '100%', display: 'block', maxHeight: '300px', objectFit: 'cover', opacity: 0.85 }} />
        ) : (
          <div style={{ height: '200px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <Video size={32} color="#6b7280" />
            <span style={{ fontSize: '13px', color: '#6b7280' }}>Add thumbnail in panel →</span>
          </div>
        )}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            width: '58px', height: '58px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}>
            <div style={{ width: 0, height: 0, borderTop: '11px solid transparent', borderBottom: '11px solid transparent', borderLeft: '20px solid #18181b', marginLeft: '5px' }} />
          </div>
        </div>
      </div>
      {block.content?.trim() && (
        <p style={{ margin: '10px 0 0', fontSize: '13px', color: theme.mutedColor, textAlign: 'center', fontFamily: theme.fontFamily }}>
          {block.content}
        </p>
      )}
    </div>
  );
}

function SocialCanvas({ block }: { block: EmailBlock }) {
  const links = (block.socialLinks ?? []).filter(l => l.url?.trim());
  if (links.length === 0) {
    return (
      <div style={{ padding: '16px 24px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
        Add your social links in the panel →
      </div>
    );
  }
  return (
    <div style={{ padding: '16px 24px', display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
      {links.map((link) => {
        const p = SOCIAL_PLATFORMS.find(sp => sp.id === link.platform);
        return (
          <span
            key={link.platform}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '38px', height: '38px', borderRadius: '50%',
              background: p?.color ?? '#6b7280',
              color: '#fff', fontSize: '13px', fontWeight: 700, fontFamily: 'sans-serif',
              flexShrink: 0,
            }}
          >
            {p?.abbr ?? link.platform.charAt(0)}
          </span>
        );
      })}
    </div>
  );
}

function AddressCanvas({ venueAddress, theme }: { venueAddress?: VenueAddress; theme: ReturnType<typeof mergeEmailTheme> }) {
  const name = venueAddress?.name ?? 'Your Venue';
  const address = venueAddress?.location_full?.trim()
    ?? (venueAddress?.location_city && venueAddress?.location_state
      ? `${venueAddress.location_city}, ${venueAddress.location_state}`
      : null);
  return (
    <div style={{ padding: '16px 24px', textAlign: 'center' }}>
      <p style={{ margin: '0 0 3px', fontSize: '13px', fontWeight: 600, color: theme.textColor, fontFamily: theme.fontFamily }}>
        {name}
      </p>
      <p style={{ margin: 0, fontSize: '12px', color: theme.mutedColor, fontFamily: theme.fontFamily }}>
        {address ?? 'Address pulled from your venue settings'}
      </p>
    </div>
  );
}

function BlockCanvas({ block, theme, venueAddress }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme>; venueAddress?: VenueAddress }) {
  switch (block.type) {
    case 'heading': return <HeadingCanvas block={block} theme={theme} />;
    case 'text':    return <TextCanvas block={block} theme={theme} />;
    case 'button':  return <ButtonCanvas block={block} theme={theme} />;
    case 'image':   return <ImageCanvas block={block} theme={theme} />;
    case 'video':   return <VideoCanvas block={block} theme={theme} />;
    case 'social':  return <SocialCanvas block={block} />;
    case 'address': return <AddressCanvas venueAddress={venueAddress} theme={theme} />;
    case 'divider': return <DividerCanvas theme={theme} />;
    case 'spacer':  return <SpacerCanvas block={block} />;
    default:        return <div style={{ padding: '12px 24px', color: '#9ca3af', fontSize: '13px' }}>[{block.type}]</div>;
  }
}

// ─── Block Picker Modal ───────────────────────────────────────────────────────
function BlockPickerModal({ onSelect, onClose }: { onSelect: (type: EmailBlockType) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 w-[480px] max-w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">Add a block</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <Minus size={18} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {PALETTE.map(({ type, label, desc, Icon }) => (
            <button
              key={type}
              type="button"
              onClick={() => onSelect(type)}
              className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-4 text-center hover:border-gray-400 hover:bg-white transition-all group"
            >
              <Icon size={22} className="text-gray-500 group-hover:text-gray-900 transition-colors" />
              <div>
                <p className="text-xs font-semibold text-gray-900">{label}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Add Block Button ─────────────────────────────────────────────────────────
function AddBlockBtn({ onClick }: { onClick: () => void }) {
  return (
    <div className="relative flex items-center justify-center py-1 group">
      <div className="absolute inset-x-6 top-1/2 h-px bg-gray-200 group-hover:bg-blue-300 transition-colors" />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white border border-gray-300 text-gray-400 shadow-sm hover:border-blue-400 hover:text-blue-500 hover:shadow transition-all"
        title="Add block"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

// ─── Right Panel — Block Inspector ───────────────────────────────────────────
function BlockInspectorPanel({
  block,
  onChange,
  onMediaPick,
}: {
  block: EmailBlock;
  onChange: (patch: Partial<EmailBlock>) => void;
  onMediaPick: (apply: (url: string) => void) => void;
}) {
  const LABEL = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1';
  const INPUT = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors';

  const AlignRow = () => (
    <div>
      <label className={LABEL}>Alignment</label>
      <div className="flex gap-1">
        {(['left', 'center', 'right'] as const).map((a) => {
          const icons = { left: <AlignLeft size={14} />, center: <AlignCenter size={14} />, right: <AlignRight size={14} /> };
          return (
            <button
              key={a}
              type="button"
              onClick={() => onChange({ align: a })}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${block.align === a ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}
            >
              {icons[a]}
            </button>
          );
        })}
      </div>
    </div>
  );

  if (block.type === 'heading') {
    return (
      <div className="space-y-4">
        <div>
          <label className={LABEL}>Text</label>
          <input
            type="text"
            className={INPUT}
            value={stripTags(block.content || '')}
            onChange={(e) => onChange({ content: e.target.value })}
          />
        </div>
        <div>
          <label className={LABEL}>Size</label>
          <div className="flex gap-1">
            {([1, 2, 3] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onChange({ level: l })}
                className={`flex h-8 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors ${block.level === l ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}
              >
                H{l}
              </button>
            ))}
          </div>
        </div>
        <AlignRow />
      </div>
    );
  }

  if (block.type === 'text') {
    return (
      <div className="space-y-4">
        <div>
          <label className={LABEL}>Content</label>
          <RichTextEditor
            content={block.content ?? ''}
            onChange={(val) => onChange({ content: val })}
          />
        </div>
        <AlignRow />
      </div>
    );
  }

  if (block.type === 'button') {
    return (
      <div className="space-y-4">
        <div>
          <label className={LABEL}>Button label</label>
          <input
            type="text"
            className={INPUT}
            value={block.buttonLabel ?? ''}
            onChange={(e) => onChange({ buttonLabel: e.target.value })}
            placeholder="Click here"
          />
        </div>
        <div>
          <label className={LABEL}>Link URL</label>
          <input
            type="url"
            className={INPUT}
            value={block.href ?? ''}
            onChange={(e) => onChange({ href: e.target.value })}
            placeholder="https://"
          />
        </div>
        <AlignRow />
      </div>
    );
  }

  if (block.type === 'image') {
    return (
      <div className="space-y-4">
        <div>
          <label className={LABEL}>Image URL</label>
          <input
            type="url"
            className={INPUT}
            value={block.src ?? ''}
            onChange={(e) => onChange({ src: e.target.value })}
            placeholder="https://..."
          />
          <button
            type="button"
            onClick={() => onMediaPick((url) => onChange({ src: url }))}
            className="mt-1.5 w-full rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Choose from Media Library
          </button>
        </div>
        <div>
          <label className={LABEL}>Alt text</label>
          <input
            type="text"
            className={INPUT}
            value={block.alt ?? ''}
            onChange={(e) => onChange({ alt: e.target.value })}
            placeholder="Describe the image"
          />
        </div>
        <div>
          <label className={LABEL}>Link URL (optional)</label>
          <input
            type="url"
            className={INPUT}
            value={block.href ?? ''}
            onChange={(e) => onChange({ href: e.target.value })}
            placeholder="https://"
          />
        </div>
        <AlignRow />
      </div>
    );
  }

  if (block.type === 'divider') {
    return <p className="text-xs text-gray-400">Horizontal rule — no extra settings needed.</p>;
  }

  if (block.type === 'spacer') {
    return (
      <div>
        <label className={LABEL}>Height (px)</label>
        <input
          type="range"
          min={8}
          max={120}
          className="w-full accent-gray-900"
          value={block.spacerHeight ?? 24}
          onChange={(e) => onChange({ spacerHeight: Number(e.target.value) })}
        />
        <p className="mt-1 text-center text-xs text-gray-500">{block.spacerHeight ?? 24} px</p>
      </div>
    );
  }

  if (block.type === 'video') {
    return (
      <div className="space-y-4">
        <div>
          <label className={LABEL}>Video URL (opens in new tab)</label>
          <input
            type="url"
            className={INPUT}
            value={block.href ?? ''}
            onChange={(e) => onChange({ href: e.target.value })}
            placeholder="https://youtube.com/watch?v=..."
          />
          <p className="mt-1 text-[11px] text-gray-400">Clicking the thumbnail opens this link</p>
        </div>
        <div>
          <label className={LABEL}>Thumbnail Image</label>
          <input
            type="url"
            className={INPUT}
            value={block.src ?? ''}
            onChange={(e) => onChange({ src: e.target.value })}
            placeholder="https://..."
          />
          <button
            type="button"
            onClick={() => onMediaPick((url) => onChange({ src: url }))}
            className="mt-1.5 w-full rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Choose from Media Library
          </button>
        </div>
        <div>
          <label className={LABEL}>Caption (optional)</label>
          <input
            type="text"
            className={INPUT}
            value={block.content ?? ''}
            onChange={(e) => onChange({ content: e.target.value })}
            placeholder="Watch our latest video"
          />
        </div>
      </div>
    );
  }

  if (block.type === 'social') {
    const links = block.socialLinks ?? [];
    const isEnabled = (platform: string) => links.some(l => l.platform === platform);
    const getUrl    = (platform: string) => links.find(l => l.platform === platform)?.url ?? '';
    const toggle    = (platform: string) => {
      if (isEnabled(platform)) {
        onChange({ socialLinks: links.filter(l => l.platform !== platform) });
      } else {
        onChange({ socialLinks: [...links, { platform, url: '' }] });
      }
    };
    const setUrl = (platform: string, url: string) => {
      onChange({ socialLinks: links.map(l => l.platform === platform ? { ...l, url } : l) });
    };
    return (
      <div className="space-y-3">
        {SOCIAL_PLATFORMS.map(({ id, label, color }) => {
          const enabled = isEnabled(id);
          return (
            <div key={id}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-3.5 w-3.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-xs font-semibold text-gray-700">{label}</span>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${enabled ? 'bg-gray-900' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
              {enabled && (
                <input
                  type="url"
                  className={INPUT}
                  value={getUrl(id)}
                  onChange={(e) => setUrl(id, e.target.value)}
                  placeholder={`https://${id}.com/yourpage`}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (block.type === 'address') {
    return (
      <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
        <p className="text-xs font-semibold text-gray-700 mb-1">Auto-filled from venue settings</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          Your business name and address are pulled automatically. To update them, go to{' '}
          <strong>Listing → Directory</strong> and update your location fields.
        </p>
      </div>
    );
  }

  return null;
}

// ─── Right Panel — Theme ──────────────────────────────────────────────────────
function ThemePanel({ theme, onChange }: {
  theme: Required<EmailTheme>;
  onChange: (patch: Partial<EmailTheme>) => void;
}) {
  const LABEL = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1';
  const INPUT = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Page bg</label>
          <div className="flex items-center gap-2">
            <input type="color" className="h-8 w-8 cursor-pointer rounded border border-gray-200 p-0.5" value={theme.pageBg} onChange={(e) => onChange({ pageBg: e.target.value })} />
            <input type="text" className={INPUT} value={theme.pageBg} onChange={(e) => onChange({ pageBg: e.target.value })} />
          </div>
        </div>
        <div>
          <label className={LABEL}>Card bg</label>
          <div className="flex items-center gap-2">
            <input type="color" className="h-8 w-8 cursor-pointer rounded border border-gray-200 p-0.5" value={theme.cardBg} onChange={(e) => onChange({ cardBg: e.target.value })} />
            <input type="text" className={INPUT} value={theme.cardBg} onChange={(e) => onChange({ cardBg: e.target.value })} />
          </div>
        </div>
        <div>
          <label className={LABEL}>Text color</label>
          <div className="flex items-center gap-2">
            <input type="color" className="h-8 w-8 cursor-pointer rounded border border-gray-200 p-0.5" value={theme.textColor} onChange={(e) => onChange({ textColor: e.target.value })} />
            <input type="text" className={INPUT} value={theme.textColor} onChange={(e) => onChange({ textColor: e.target.value })} />
          </div>
        </div>
        <div>
          <label className={LABEL}>Button bg</label>
          <div className="flex items-center gap-2">
            <input type="color" className="h-8 w-8 cursor-pointer rounded border border-gray-200 p-0.5" value={theme.buttonBg} onChange={(e) => onChange({ buttonBg: e.target.value })} />
            <input type="text" className={INPUT} value={theme.buttonBg} onChange={(e) => onChange({ buttonBg: e.target.value })} />
          </div>
        </div>
      </div>
      <div>
        <label className={LABEL}>Font family</label>
        <select
          className={INPUT}
          value={theme.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
        >
          <option value="Georgia, 'Times New Roman', serif">Georgia (Serif)</option>
          <option value="'Helvetica Neue', Helvetica, Arial, sans-serif">Helvetica (Sans-serif)</option>
          <option value="'Open Sans', Arial, sans-serif">Open Sans</option>
          <option value="Verdana, Geneva, sans-serif">Verdana</option>
          <option value="'Trebuchet MS', sans-serif">Trebuchet MS</option>
        </select>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function CampaignFlodeskBuilder({
  campaignId,
  templateId,
  initialName,
  initialSubject,
  initialPreheader,
  initialDefinition,
  venueAddress,
}: {
  campaignId: string;
  templateId: string;
  initialName: string;
  initialSubject: string;
  initialPreheader: string;
  initialDefinition: MarketingEmailDefinition;
  venueAddress?: VenueAddress;
}) {
  const [name, setName]           = useState(initialName);
  const [subject, setSubject]     = useState(initialSubject);
  const [preheader, setPreheader] = useState(initialPreheader);
  const [def, setDef]             = useState<MarketingEmailDefinition>(initialDefinition);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerIdx, setPickerIdx]   = useState<number | null>(null); // insert before index
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const mediaApplyRef = useRef<(url: string) => void>(() => {});
  const saveTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const theme = mergeEmailTheme(def.theme);

  // ── Auto-save ──────────────────────────────────────────────────────────────
  const save = useCallback(async (
    n: string,
    sub: string,
    pre: string,
    d: MarketingEmailDefinition,
  ) => {
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/marketing/email-templates/${templateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, subject: sub, preheader: pre, definition: d }),
      });
      setSaveStatus(res.ok ? 'saved' : 'error');
      if (res.ok) setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
    }
  }, [templateId]);

  const scheduleSave = useCallback((
    n: string, sub: string, pre: string, d: MarketingEmailDefinition,
  ) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('idle');
    saveTimerRef.current = setTimeout(() => void save(n, sub, pre, d), 1500);
  }, [save]);

  // Also save campaign name/subject via PATCH to campaign route
  const saveCampaignMeta = useCallback(async (n: string, sub: string) => {
    await fetch(`/api/marketing/campaigns/${campaignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_draft', name: n, subject: sub }),
    });
  }, [campaignId]);

  // ── Block mutations ────────────────────────────────────────────────────────
  function updateDef(next: MarketingEmailDefinition) {
    setDef(next);
    scheduleSave(name, subject, preheader, next);
  }

  function addBlockAt(idx: number, type: EmailBlockType) {
    const nb = createEmailBlock(type);
    const blocks = [...def.blocks];
    blocks.splice(idx, 0, nb);
    const next = { ...def, blocks };
    updateDef(next);
    setSelectedId(nb.id);
    setPickerIdx(null);
  }

  function removeBlock(id: string) {
    const next = { ...def, blocks: def.blocks.filter((b) => b.id !== id) };
    updateDef(next);
    if (selectedId === id) setSelectedId(null);
  }

  function duplicateBlock(id: string) {
    const idx = def.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const copy = { ...def.blocks[idx], id: crypto.randomUUID() };
    const blocks = [...def.blocks];
    blocks.splice(idx + 1, 0, copy);
    updateDef({ ...def, blocks });
    setSelectedId(copy.id);
  }

  function moveBlock(id: string, dir: 'up' | 'down') {
    const idx = def.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const next = moveArr(def.blocks, idx, dir === 'up' ? idx - 1 : idx + 1);
    updateDef({ ...def, blocks: next });
  }

  function patchBlock(id: string, patch: Partial<EmailBlock>) {
    const blocks = def.blocks.map((b) => b.id === id ? { ...b, ...patch } as EmailBlock : b);
    updateDef({ ...def, blocks });
  }

  function patchTheme(patch: Partial<EmailTheme>) {
    const next = { ...def, theme: { ...def.theme, ...patch } };
    updateDef(next);
  }

  const selectedBlock = def.blocks.find((b) => b.id === selectedId) ?? null;

  // ── Render ─────────────────────────────────────────────────────────────────
  const saveLabel = saveStatus === 'saving' ? 'Saving…'
    : saveStatus === 'saved' ? 'Saved'
    : saveStatus === 'error' ? 'Save failed'
    : null;

  return (
    // Break out of dashboard padding
    <div className="-mx-6 sm:-mx-8 lg:-mx-10 -mt-6 lg:-mt-[68px] -mb-10 flex flex-col bg-white"
      style={{ minHeight: '100vh' }}
    >
      {/* ── Top Bar ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-gray-200 bg-white px-5 py-3 shadow-sm">
        <Link
          href="/dashboard/marketing/email/campaigns"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors flex-shrink-0"
        >
          <ArrowLeft size={16} /> Emails
        </Link>

        <div className="h-4 w-px bg-gray-200 flex-shrink-0" />

        {/* Campaign name */}
        <input
          className="min-w-[140px] max-w-[260px] flex-1 rounded-lg border border-transparent px-2.5 py-1.5 text-sm font-semibold text-gray-900 hover:border-gray-200 focus:border-gray-300 focus:bg-gray-50 focus:outline-none transition-colors"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            scheduleSave(e.target.value, subject, preheader, def);
            void saveCampaignMeta(e.target.value, subject);
          }}
          placeholder="Campaign name"
        />

        {/* Step breadcrumbs */}
        <div className="hidden sm:flex items-center gap-1 text-xs font-medium ml-auto">
          <span className="rounded-full bg-gray-900 px-3 py-1 text-white">Design</span>
          <ChevronRight size={14} className="text-gray-400" />
          <Link
            href={`/dashboard/marketing/email/campaigns/${campaignId}`}
            className="rounded-full px-3 py-1 text-gray-400 hover:text-gray-700 transition-colors"
          >
            Audience
          </Link>
          <ChevronRight size={14} className="text-gray-400" />
          <Link
            href={`/dashboard/marketing/email/campaigns/${campaignId}`}
            className="rounded-full px-3 py-1 text-gray-400 hover:text-gray-700 transition-colors"
          >
            Send
          </Link>
        </div>

        {/* Save status */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {saveStatus === 'saving' && <Loader2 size={14} className="animate-spin text-gray-400" />}
          {saveStatus === 'saved'  && <Check size={14} className="text-emerald-500" />}
          {saveLabel && <span className={`text-xs ${saveStatus === 'error' ? 'text-red-500' : 'text-gray-400'}`}>{saveLabel}</span>}
        </div>

        {/* Next button */}
        <Link
          href={`/dashboard/marketing/email/campaigns/${campaignId}`}
          onClick={() => void save(name, subject, preheader, def)}
          className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 transition-colors flex-shrink-0"
        >
          Next <ChevronRight size={15} />
        </Link>
      </header>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 57px)' }}>

        {/* ── Canvas ───────────────────────────────────────────────────────── */}
        <div
          className="flex-1 overflow-y-auto px-4 py-8"
          style={{ background: theme.pageBg }}
          onClick={() => setSelectedId(null)}
        >
          {/* Subject bar above email card */}
          <div className="mx-auto mb-3 flex items-center gap-2" style={{ maxWidth: theme.maxWidth }}>
            <span className="text-xs text-gray-400 font-medium flex-shrink-0">Subject</span>
            <input
              className="flex-1 rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none transition-colors"
              value={subject}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                setSubject(e.target.value);
                scheduleSave(name, e.target.value, preheader, def);
              }}
              placeholder="Your email subject line"
            />
          </div>

          {/* Email card */}
          <div
            className="mx-auto overflow-hidden rounded-xl shadow-sm"
            style={{ maxWidth: theme.maxWidth, background: theme.cardBg }}
            onClick={(e) => e.stopPropagation()}
          >
            {def.blocks.length === 0 ? (
              <div className="py-16 text-center">
                <p className="mb-4 text-sm text-gray-400">Your email is empty</p>
                <button
                  type="button"
                  onClick={() => setPickerIdx(0)}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                >
                  <Plus size={16} /> Add your first block
                </button>
              </div>
            ) : (
              <>
                {/* Top add button */}
                <AddBlockBtn onClick={() => setPickerIdx(0)} />

                {def.blocks.map((block, idx) => {
                  const isSelected = block.id === selectedId;
                  return (
                    <div key={block.id}>
                      {/* Block row */}
                      <div className="relative group" onClick={(e) => { e.stopPropagation(); setSelectedId(block.id); }}>
                        {/* Selection border */}
                        <div
                          className="relative cursor-pointer"
                          style={{
                            transition: 'box-shadow 0.3s ease, outline 0.15s ease',
                            outline: isSelected ? '2px solid #3b82f6' : '2px solid transparent',
                            outlineOffset: '-2px',
                            boxShadow: isSelected ? 'none' : undefined,
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 22px rgba(0,0,0,0.11), 0 1px 6px rgba(0,0,0,0.07)';
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                          }}
                        >
                          <BlockCanvas block={block} theme={theme} venueAddress={venueAddress} />
                        </div>

                        {/* Floating toolbar — visible when selected */}
                        {isSelected && (
                          <div
                            className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 z-10"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              title="Move up"
                              disabled={idx === 0}
                              onClick={() => moveBlock(block.id, 'up')}
                              className="flex h-7 w-7 items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-500 shadow-sm hover:bg-gray-50 disabled:opacity-30 transition-all"
                            ><ChevronUp size={13} /></button>
                            <button
                              type="button"
                              title="Move down"
                              disabled={idx === def.blocks.length - 1}
                              onClick={() => moveBlock(block.id, 'down')}
                              className="flex h-7 w-7 items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-500 shadow-sm hover:bg-gray-50 disabled:opacity-30 transition-all"
                            ><ChevronDown size={13} /></button>
                            <button
                              type="button"
                              title="Duplicate"
                              onClick={() => duplicateBlock(block.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-500 shadow-sm hover:bg-gray-50 transition-all"
                            ><Copy size={13} /></button>
                            <button
                              type="button"
                              title="Delete"
                              onClick={() => removeBlock(block.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg bg-white border border-red-100 text-red-400 shadow-sm hover:bg-red-50 hover:text-red-600 transition-all"
                            ><Trash2 size={13} /></button>
                          </div>
                        )}
                      </div>

                      {/* Add button after this block */}
                      <AddBlockBtn onClick={() => setPickerIdx(idx + 1)} />
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Merge field hint */}
          <p className="mx-auto mt-4 text-center text-[11px] text-gray-400" style={{ maxWidth: theme.maxWidth }}>
            Use{' '}
            <code className="font-mono">{'{{first_name}}'}</code>,{' '}
            <code className="font-mono">{'{{venue_name}}'}</code>,{' '}
            <code className="font-mono">{'{{unsubscribe_url}}'}</code> as merge fields
          </p>
        </div>

        {/* ── Right Panel ──────────────────────────────────────────────────── */}
        <aside
          className="w-72 flex-shrink-0 overflow-y-auto border-l border-gray-200 bg-white"
          onClick={(e) => e.stopPropagation()}
        >
          {selectedBlock ? (
            <div className="p-5">
              {/* Block type label */}
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                    {selectedBlock.type}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                >
                  Done
                </button>
              </div>

              <BlockInspectorPanel
                block={selectedBlock}
                onChange={(patch) => patchBlock(selectedBlock.id, patch)}
                onMediaPick={(apply) => {
                  mediaApplyRef.current = apply;
                  setMediaPickerOpen(true);
                }}
              />

              <div className="mt-6 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={() => removeBlock(selectedBlock.id)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-100 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={12} /> Remove block
                </button>
              </div>
            </div>
          ) : (
            <div className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <Palette size={15} className="text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-900">Email style</h3>
              </div>

              {/* Preheader */}
              <div className="mb-5">
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Preheader text
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors"
                  value={preheader}
                  onChange={(e) => {
                    setPreheader(e.target.value);
                    scheduleSave(name, subject, e.target.value, def);
                  }}
                  placeholder="Preview text after subject line"
                />
                <p className="mt-1 text-[10px] text-gray-400">Shown in inbox preview after the subject</p>
              </div>

              <ThemePanel theme={theme} onChange={patchTheme} />

              <p className="mt-5 text-[11px] text-gray-400 text-center">
                Click any block on the canvas to edit it
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* Block picker modal */}
      {pickerIdx !== null && (
        <BlockPickerModal
          onSelect={(type) => addBlockAt(pickerIdx, type)}
          onClose={() => setPickerIdx(null)}
        />
      )}

      {/* Media picker */}
      <VenueMediaPickerModal
        open={mediaPickerOpen}
        onOpenChange={setMediaPickerOpen}
        onSelect={(url) => {
          mediaApplyRef.current(url);
          setMediaPickerOpen(false);
        }}
      />
    </div>
  );
}
