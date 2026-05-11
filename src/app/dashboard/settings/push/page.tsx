import type { Metadata } from 'next';
import PushNotificationsClientPage from './PushNotificationsClientPage';

export const metadata: Metadata = {
  title: 'Push Notifications',
};

export default function PushNotificationsPage() {
  return <PushNotificationsClientPage />;
}
