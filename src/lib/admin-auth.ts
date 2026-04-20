import { cookies } from 'next/headers';

export async function verifyAdminCookie(): Promise<boolean> {
  const c = await cookies();
  const t = c.get('admin_token')?.value;
  return Boolean(t && t === process.env.ADMIN_SECRET);
}
