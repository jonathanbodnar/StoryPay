'use client';

import { getIanaTimeZoneOptions } from '@/lib/venue-timezone';

export function TimezoneSelect({
  value,
  onChange,
  className = '',
  id,
  disabled,
}: {
  value: string;
  onChange: (tz: string) => void;
  className?: string;
  id?: string;
  disabled?: boolean;
}) {
  const zones = getIanaTimeZoneOptions();
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={
        className ||
        'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none'
      }
    >
      {zones.map((z) => (
        <option key={z} value={z}>
          {z}
        </option>
      ))}
    </select>
  );
}
