import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import GHLFallback from './fallback';

function extractLocationId(referer: string | null): string | null {
  if (!referer) return null;
  const match = referer.match(/\/location\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

export default async function GHLLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const headerList = await headers();

  const qpLocationId = typeof params.locationId === 'string' ? params.locationId : null;

  if (qpLocationId) {
    redirect(`/api/auth/ghl/${qpLocationId}`);
  }

  const referer = headerList.get('referer');
  const refLocationId = extractLocationId(referer);

  if (refLocationId) {
    redirect(`/api/auth/ghl/${refLocationId}`);
  }

  return <GHLFallback />;
}
