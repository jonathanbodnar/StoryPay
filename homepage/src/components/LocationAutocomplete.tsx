'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2, X } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';

export interface LocationSuggestion {
  label: string;
  city: string;
  state: string;
  zip?: string;
  lat: number;
  lng: number;
}

interface Props {
  value: string;
  onChange: (raw: string) => void;
  onSelect: (suggestion: LocationSuggestion) => void;
  placeholder?: string;
  className?: string;
}

export function LocationAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = 'City, state, or zip…',
  className = '',
}: Props) {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [loading, setLoading]         = useState(false);
  const [open, setOpen]               = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function handleInput(raw: string) {
    onChange(raw);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (raw.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/public/location-suggestions?q=${encodeURIComponent(raw)}`,
        );
        const data = await res.json();
        const list: LocationSuggestion[] = Array.isArray(data.suggestions) ? data.suggestions : [];
        setSuggestions(list);
        setOpen(list.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 280);
  }

  function handleSelect(s: LocationSuggestion) {
    onChange(s.label);
    setSuggestions([]);
    setOpen(false);
    onSelect(s);
  }

  function handleClear() {
    onChange('');
    setSuggestions([]);
    setOpen(false);
    onSelect({ label: '', city: '', state: '', lat: 0, lng: 0 });
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <MapPin size={15} className="pointer-events-none absolute left-3 text-gray-400 shrink-0" />
        <input
          type="text"
          value={value}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-8 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
        />
        {loading && (
          <Loader2 size={13} className="absolute right-3 animate-spin text-gray-400" />
        )}
        {!loading && value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 text-gray-400 hover:text-gray-600"
            aria-label="Clear location"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-gray-50"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in input until we handle it
                  handleSelect(s);
                }}
              >
                <MapPin size={13} className="shrink-0 text-gray-400" />
                <span className="text-gray-800">{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
