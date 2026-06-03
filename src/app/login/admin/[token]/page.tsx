import { redirect } from 'next/navigation';

export default async function AdminLoginPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/api/auth/admin-venue/${token}`);
}
