'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

interface BookedDate { date: string; event_type: string; space: string | null; }
interface AvailabilityData {
  venue: { name: string };
  booked: BookedDate[];
  year: number;
  month: number;
}

/** Short label under the day number when the day is booked (fits tiny cell). */
const BOOKED_DAY_SUBLABEL: Record<string, string> = {
  tour: 'Tour',
  phone_call: 'Call',
};

export default function AvailabilityPage() {
  const { token } = useParams() as { token: string };
  const today     = new Date();

  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [data, setData]   = useState<AvailabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await fetch(`/api/availability/${token}?year=${year}&month=${month + 1}`);
      if (res.status === 404) { setNotFound(true); setLoading(false); return; }
      if (res.ok) setData(await res.json());
      setLoading(false);
    }
    load();
  }, [token, year, month]);

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  const bookedSet = new Set((data?.booked ?? []).map(b => b.date));

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isPast = (day: number) => new Date(year, month, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Venue not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-8">
          {data && <h1 className="font-heading text-2xl text-gray-900 mb-1">{data.venue.name}</h1>}
          <p className="text-gray-500 text-sm">Check available dates for your event</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {/* Navigation */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <button onClick={prevMonth} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 transition-colors"><ChevronLeft size={16} /></button>
            <span className="text-base font-semibold text-gray-900">{MONTHS[month]} {year}</span>
            <button onClick={nextMonth} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 transition-colors"><ChevronRight size={16} /></button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {DAYS.map(d => (
              <div key={d} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-400">{d}</div>
            ))}
          </div>

          {/* Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin text-gray-300" size={28} /></div>
          ) : (
            <div className="grid grid-cols-7">
              {cells.map((day, idx) => {
                if (!day) return <div key={idx} className="h-14 bg-gray-50/40 border-b border-r border-gray-100" />;
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isBooked  = bookedSet.has(dateStr);
                const past      = isPast(day);
                const isToday   = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                const booked    = (data?.booked ?? []).filter(b => b.date === dateStr);

                return (
                  <div
                    key={idx}
                    className={`h-14 border-b border-r border-gray-100 flex flex-col items-center justify-center gap-0.5 ${
                      isBooked ? 'bg-red-50' : past ? 'bg-gray-50/60' : 'bg-white hover:bg-green-50/40 transition-colors'
                    }`}
                  >
                    <span className={`text-xs font-medium w-7 h-7 flex items-center justify-center rounded-full ${
                      isToday ? 'text-white' : past ? 'text-gray-300' : isBooked ? 'text-red-600' : 'text-gray-700'
                    }`} style={isToday ? { backgroundColor: '#1b1b1b' } : {}}>
                      {day}
                    </span>
                    {isBooked && !past && (
                      <span className="text-[9px] font-semibold text-red-500 leading-none">
                        {BOOKED_DAY_SUBLABEL[booked[0]?.event_type ?? ''] ?? 'Booked'}
                      </span>
                    )}
                    {!isBooked && !past && (
                      <span className="text-[9px] font-medium text-emerald-600 leading-none">Open</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-5">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span className="w-3 h-3 rounded-full bg-emerald-400 inline-block" />
            Available
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span className="w-3 h-3 rounded-full bg-red-400 inline-block" />
            Booked / Unavailable
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Contact {data?.venue.name ?? 'the venue'} to book your date.
        </p>
      </div>
    </div>
  );
}
