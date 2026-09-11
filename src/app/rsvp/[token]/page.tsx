import RsvpClient from './RsvpClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'RSVP',
  robots: { index: false, follow: false },
};

export default async function RsvpPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <RsvpClient token={token} />;
}
