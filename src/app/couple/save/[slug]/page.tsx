import { Suspense } from 'react';
import { SaveVenueClient } from './SaveVenueClient';

// Auth state for couples lives in the browser (localStorage), so this has to
// run client-side. The server shell just resolves the slug param and defers.
export default async function SaveVenuePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <Suspense
      fallback={<div className="py-12 text-center text-sm text-gray-500">Saving…</div>}
    >
      <SaveVenueClient slug={slug} />
    </Suspense>
  );
}
