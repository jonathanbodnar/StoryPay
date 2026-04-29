'use client';

/**
 * /setup is no longer part of the account creation flow.
 * StoryPay payment processing is optional and can be applied for
 * directly inside the dashboard via the Payments nav menu.
 *
 * Redirect all visitors to the dashboard immediately.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SetupPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);
  return null;
}
