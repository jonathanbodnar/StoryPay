import { redirect } from 'next/navigation';

export default async function LoginPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/api/auth/venue/${token}`);
}
