"use client";

// Realtime visitor map: a Leaflet + OpenStreetMap world map that plots one
// marker per active session (last 30 min) and refreshes automatically as the
// parent page re-fetches realtime data. Leaflet touches `window`/`document`
// at import time, so the entire module is behind a client boundary and we
// load leaflet lazily from useEffect to keep SSR happy.

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker, CircleMarker, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";

export type GeoPoint = {
  session_id: string;
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  country: string | null;
  flag: string;
  label: string;
  ago_seconds: number;
  live: boolean;
};

type Props = {
  points: GeoPoint[];
  heightClass?: string; // tailwind height utility, default h-96
};

// Continental-US bounding box (SW → NE). Fitting to this guarantees the whole
// country is visible regardless of the container's aspect ratio (portrait phone
// vs. wide desktop), instead of a fixed zoom that clips to the Midwest.
const US_BOUNDS: [[number, number], [number, number]] = [
  [24.4, -125.0],
  [49.4, -66.9],
];

export default function VisitorMap({ points, heightClass = "h-96" }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const pointsRef = useRef<GeoPoint[]>(points);
  const fitViewRef = useRef<(() => void) | null>(null);
  const userMovedRef = useRef(false);
  const programmaticRef = useRef(false);

  // One-time map initialisation.
  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let nudgeTimers: ReturnType<typeof setTimeout>[] = [];
    (async () => {
      if (!containerRef.current || mapRef.current) return;
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        // Seeded with a rough continental-US view; fitView() below refines it
        // to the exact US bounds once the container has its final size.
        center: [39.5, -98.35],
        zoom: 3,
        minZoom: 2,
        maxZoom: 18,
        worldCopyJump: true,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true,
      });

      // Mapbox "Light" style rendered as raster tiles via the Static Tiles
      // API — a clean, light gray basemap matching the Google Analytics
      // "Realtime overview" aesthetic (light blue water, muted gray land,
      // subtle borders). Swapped in from CartoDB's free basemap CDN after
      // CARTO started requiring an API key on that endpoint (2026).
      // Requires NEXT_PUBLIC_MAPBOX_TOKEN — see .env.example. Falls back to
      // plain OpenStreetMap tiles (still free, no key) if unset so the map
      // never silently breaks in an environment missing the token.
      const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      const tileUrl = mapboxToken
        ? `https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/256/{z}/{x}/{y}?access_token=${mapboxToken}`
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
      const tileAttribution = mapboxToken
        ? '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

      L.tileLayer(tileUrl, {
        attribution: tileAttribution,
        subdomains: "abcd",
        maxZoom: 20,
      }).addTo(map);

      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);

      // Once the owner pans/zooms manually, stop auto-fitting so we don't yank
      // the view out from under them on the next realtime refresh. Programmatic
      // fitBounds calls are flagged so they don't count as user movement.
      map.on("movestart", () => {
        if (!programmaticRef.current) userMovedRef.current = true;
      });

      // Fit the map to the current data: the whole US when there are no live
      // visitors, or tight around the active markers (capped zoom) when there
      // are. No-ops once the user has taken control of the view.
      const fitView = () => {
        const m = mapRef.current;
        if (!m || userMovedRef.current) return;
        const pts = pointsRef.current;
        programmaticRef.current = true;
        if (!pts.length) {
          m.fitBounds(US_BOUNDS, { padding: [12, 12], animate: false });
        } else {
          let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
          for (const p of pts) {
            minLat = Math.min(minLat, p.lat);
            maxLat = Math.max(maxLat, p.lat);
            minLng = Math.min(minLng, p.lng);
            maxLng = Math.max(maxLng, p.lng);
          }
          m.fitBounds([[minLat, minLng], [maxLat, maxLng]], {
            padding: [40, 40],
            maxZoom: 8,
            animate: false,
          });
        }
        // Release the programmatic flag after this frame's move settles.
        setTimeout(() => { programmaticRef.current = false; }, 0);
      };
      fitViewRef.current = fitView;
      fitView();

      // Two reasons Leaflet can render white on one side:
      //   1. The container got its final width AFTER L.map() ran (common
      //      inside tabs, flex layouts, or conditionally rendered blocks).
      //   2. The dashboard window was resized and the map wasn't told.
      // Both are solved by calling invalidateSize() whenever the container
      // changes size, plus a few post-mount nudges to catch the first paint.
      resizeObserver = new ResizeObserver(() => {
        if (mapRef.current) mapRef.current.invalidateSize();
      });
      resizeObserver.observe(containerRef.current);
      nudgeTimers = [0, 60, 240, 600].map((ms) =>
        setTimeout(() => {
          mapRef.current?.invalidateSize();
          // Re-fit after the container reaches its real size so the US view
          // isn't computed against a zero/partial-width map on first paint.
          fitViewRef.current?.();
        }, ms)
      );
    })();

    return () => {
      cancelled = true;
      nudgeTimers.forEach((t) => clearTimeout(t));
      if (resizeObserver) resizeObserver.disconnect();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
      }
    };
  }, []);

  // Re-render markers whenever the realtime payload changes.
  useEffect(() => {
    pointsRef.current = points;
    let cancelled = false;
    (async () => {
      const map = mapRef.current;
      const layer = layerRef.current;
      if (!map || !layer) return;
      const L = (await import("leaflet")).default;
      if (cancelled) return;

      layer.clearLayers();

      // Group points at identical coords (e.g. two visitors in the same city)
      // so their markers stack with a small count bubble.
      const grouped = new Map<
        string,
        { lat: number; lng: number; items: GeoPoint[] }
      >();
      for (const p of points) {
        const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
        const entry = grouped.get(key);
        if (entry) entry.items.push(p);
        else grouped.set(key, { lat: p.lat, lng: p.lng, items: [p] });
      }

      const markers: (Marker | CircleMarker)[] = [];
      for (const { lat, lng, items } of grouped.values()) {
        const primary = items[0];
        const count = items.length;
        const isLive = items.some((i) => i.live);

        // Pulsing dot for live visitors, muted dot for recent-but-not-live.
        const html = `
          <div class="vm-marker ${isLive ? "vm-marker-live" : "vm-marker-recent"}">
            ${isLive ? '<span class="vm-pulse"></span>' : ""}
            <span class="vm-core">${count > 1 ? count : ""}</span>
          </div>`;
        const icon = L.divIcon({
          className: "vm-icon",
          html,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const marker = L.marker([lat, lng], { icon });

        const placeLine = [primary.city, primary.region, primary.country]
          .filter(Boolean)
          .join(", ");
        const agoLabel = humanizeAgo(primary.ago_seconds);
        const list = items
          .slice(0, 5)
          .map(
            (i) =>
              `<li>${i.label} &middot; <span style="color:#6b7280">${humanizeAgo(
                i.ago_seconds
              )}</span></li>`
          )
          .join("");
        const extra = items.length > 5 ? `<li>+${items.length - 5} more…</li>` : "";

        marker.bindPopup(
          `<div style="font: 500 12px/1.4 system-ui, sans-serif; min-width: 180px;">
            <div style="font-weight:600; font-size:13px; margin-bottom:2px;">
              ${primary.flag ?? ""} ${placeLine || "Unknown location"}
            </div>
            <div style="color:#6b7280; margin-bottom:6px;">
              ${count === 1 ? `1 visitor · ${agoLabel}` : `${count} visitors here`}
            </div>
            <ul style="margin:0; padding:0 0 0 14px;">${list}${extra}</ul>
          </div>`
        );

        marker.addTo(layer);
        markers.push(marker);
      }

      // Fit to the data: whole US when idle, zoomed to visitors when present.
      // Skips itself once the owner has manually moved the map.
      fitViewRef.current?.();
    })();

    return () => {
      cancelled = true;
    };
  }, [points]);

  return (
    <>
      <div
        ref={containerRef}
        className={`${heightClass} w-full rounded-2xl overflow-hidden border border-gray-200 bg-[#e9edf1]`}
      />
      <style jsx global>{`
        .leaflet-container {
          font-family: inherit;
          /* CartoDB Positron water tone — shown before tiles load so the
             map doesn't flash white on first render. */
          background: #d4dadc;
          /* Confine Leaflet's internal panes/controls (which use z-index up to
             ~1000) into their own stacking context so they can't render above
             overlays/modals on the page. */
          position: relative;
          z-index: 0;
          isolation: isolate;
        }
        /* Google-ish zoom control: rounded square, subtle shadow, no hard border. */
        .leaflet-control-zoom {
          border: none !important;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08) !important;
          border-radius: 10px !important;
          overflow: hidden;
        }
        .leaflet-control-zoom a {
          background: #fff !important;
          color: #374151 !important;
          border: none !important;
          width: 30px !important;
          height: 30px !important;
          line-height: 30px !important;
          font-size: 16px !important;
        }
        .leaflet-control-zoom a:hover {
          background: #f3f4f6 !important;
        }
        .leaflet-control-attribution {
          background: rgba(255, 255, 255, 0.85) !important;
          font-size: 9px !important;
          color: #9ca3af !important;
        }
        .leaflet-control-attribution a {
          color: #6b7280 !important;
        }
        .vm-icon {
          background: transparent;
          border: none;
        }
        .vm-marker {
          position: relative;
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .vm-marker .vm-core {
          position: relative;
          z-index: 2;
          width: 14px;
          height: 14px;
          border-radius: 9999px;
          border: 2px solid #fff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
          color: #fff;
          font: 600 10px/1 system-ui, -apple-system, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .vm-marker-live .vm-core {
          background: #ef4444;
        }
        .vm-marker-recent .vm-core {
          background: #6366f1;
        }
        .vm-pulse {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          background: rgba(239, 68, 68, 0.5);
          animation: vmPulse 1.6s ease-out infinite;
        }
        @keyframes vmPulse {
          0% {
            transform: scale(0.6);
            opacity: 0.7;
          }
          100% {
            transform: scale(2.2);
            opacity: 0;
          }
        }
      `}</style>
    </>
  );
}

function humanizeAgo(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
