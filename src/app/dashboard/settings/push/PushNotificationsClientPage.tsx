'use client';

import PushNotificationManager from '@/components/PushNotificationManager';

export default function PushNotificationsClientPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-2xl text-gray-900">Push Notifications</h1>
        <p className="mt-1 text-sm text-gray-500">
          Get instant alerts on your phone or desktop for the moments that matter — new leads, messages, payments, and more. Enable once per device and choose which events you want to be notified about.
        </p>
      </div>
      <PushNotificationManager />
    </div>
  );
}
