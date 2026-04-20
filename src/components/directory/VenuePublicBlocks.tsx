import type { ReactNode } from 'react';
import { Facebook, Globe, Instagram } from 'lucide-react';
import type { PublicVenueFaqItem, PublicVenueSocialLinks } from '@/lib/public-venue-directory';

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  );
}

function PinterestIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.343l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24.009 12.017 24.009c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641.001 12.017.001z" />
    </svg>
  );
}

export function VenueMapEmbed({
  lat,
  lng,
  show,
}: {
  lat: number | null;
  lng: number | null;
  show: boolean;
}) {
  if (!show || lat == null || lng == null) return null;
  const pad = 0.03;
  const bbox = `${lng - pad},${lat - pad},${lng + pad},${lat + pad}`;
  return (
    <section className="space-y-3">
      <h2
        className="text-xl text-gray-900"
        style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
      >
        Location
      </h2>
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <iframe
          title="Venue location map"
          className="h-[min(320px,50vh)] w-full"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lng}`)}`}
        />
      </div>
    </section>
  );
}

const linkBtn =
  'inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50';

export function VenueSocialRow({ social }: { social: PublicVenueSocialLinks }) {
  const entries = Object.entries(social).filter(([, u]) => u && u.startsWith('http'));
  if (entries.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2
        className="text-xl text-gray-900"
        style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
      >
        Connect
      </h2>
      <div className="flex flex-wrap gap-2">
        {entries.map(([key, url]) => {
          const u = url as string;
          let icon: ReactNode;
          let label: string;
          switch (key) {
            case 'facebook':
              icon = <Facebook className="h-4 w-4" />;
              label = 'Facebook';
              break;
            case 'instagram':
              icon = <Instagram className="h-4 w-4" />;
              label = 'Instagram';
              break;
            case 'tiktok':
              icon = <TikTokIcon className="h-4 w-4" />;
              label = 'TikTok';
              break;
            case 'pinterest':
              icon = <PinterestIcon className="h-4 w-4" />;
              label = 'Pinterest';
              break;
            case 'website':
              icon = <Globe className="h-4 w-4" />;
              label = 'Website';
              break;
            default:
              icon = <Globe className="h-4 w-4" />;
              label = key;
          }
          return (
            <a
              key={key}
              href={u}
              target="_blank"
              rel="noopener noreferrer"
              className={linkBtn}
              aria-label={label}
            >
              {icon}
            </a>
          );
        })}
      </div>
    </section>
  );
}

export function VenueFaqSection({ items }: { items: PublicVenueFaqItem[] }) {
  if (!items.length) return null;
  return (
    <section className="space-y-4">
      <h2
        className="text-xl text-gray-900"
        style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
      >
        FAQ
      </h2>
      <dl className="space-y-4">
        {items.map((item, i) => (
          <div key={i} className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
            <dt className="font-semibold text-gray-900">{item.question}</dt>
            <dd className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-600">{item.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
