'use client';

import { useEffect, useRef } from 'react';

interface MapboxVenueMapProps {
  lat: number;
  lng: number;
  /** Optional venue name shown in the popup */
  venueName?: string;
}

/**
 * Interactive Mapbox GL JS map for public venue listing pages.
 * Requires NEXT_PUBLIC_MAPBOX_TOKEN to be set.
 * Falls back to nothing when the token is absent (avoids breaking SSR or
 * environments that haven't set the variable yet).
 */
export default function MapboxVenueMap({ lat, lng, venueName }: MapboxVenueMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || !containerRef.current || mapRef.current) return;

    let map: mapboxgl.Map | null = null;
    let marker: mapboxgl.Marker | null = null;

    // Dynamic import keeps the 700 kB mapbox-gl bundle out of the initial JS
    // payload — it only loads when this component actually mounts in the browser.
    void import('mapbox-gl').then((mapboxgl) => {
      if (!containerRef.current) return;

      mapboxgl.default.accessToken = token;

      map = new mapboxgl.default.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [lng, lat],
        zoom: 14,
        attributionControl: true,
      });

      // Custom branded marker
      const el = document.createElement('div');
      el.style.cssText = [
        'width:32px',
        'height:44px',
        'cursor:pointer',
        'background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 28 40\'%3E%3Cpath d=\'M14 0C6.3 0 0 6.3 0 14c0 9.3 12.6 24.5 13.1 25.1.5.6 1.3.6 1.8 0C15.4 38.5 28 23.3 28 14 28 6.3 21.7 0 14 0z\' fill=\'%231b1b1b\' stroke=\'%23ffffff\' stroke-width=\'1.5\'/%3E%3Ccircle cx=\'14\' cy=\'14\' r=\'5\' fill=\'%23ffffff\'/%3E%3C/svg%3E")',
        'background-size:contain',
        'background-repeat:no-repeat',
      ].join(';');

      marker = new mapboxgl.default.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat]);

      if (venueName) {
        marker.setPopup(
          new mapboxgl.default.Popup({ offset: 25, closeButton: false })
            .setHTML(
              `<span style="font-family:-apple-system,sans-serif;font-size:13px;font-weight:600;color:#1b1b1b">${venueName}</span>`,
            ),
        );
      }

      marker.addTo(map);
      mapRef.current = map;
    });

    return () => {
      marker?.remove();
      map?.remove();
      mapRef.current = null;
    };
    // lat/lng/venueName are stable for a given page — no need to re-init
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-[min(360px,55vh)] w-full rounded-2xl overflow-hidden"
      aria-label="Venue location map"
    />
  );
}
