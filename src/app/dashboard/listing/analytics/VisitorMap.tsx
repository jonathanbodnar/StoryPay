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

export default function VisitorMap({ points, heightClass = "h-96" }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const didAutoFitRef = useRef(false);

  // One-time map initialisation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!containerRef.current || mapRef.current) return;
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [20, 0],
        zoom: 2,
        minZoom: 2,
        maxZoom: 18,
        worldCopyJump: true,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
      }
    };
  }, []);

  // Re-render markers whenever the realtime payload changes.
  useEffect(() => {
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

      // On the first batch that has data, fit the map to the markers so the
      // owner doesn't have to pan. After that we leave zoom alone — the user
      // may have zoomed in on a city and we don't want to yank it back.
      if (!didAutoFitRef.current && markers.length > 0) {
        const bounds = L.featureGroup(markers).getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds.pad(0.4), { maxZoom: 6, animate: false });
        }
        didAutoFitRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [points]);

  return (
    <>
      <div
        ref={containerRef}
        className={`${heightClass} w-full rounded-2xl overflow-hidden border border-gray-200 bg-white`}
      />
      <style jsx global>{`
        .leaflet-container {
          font-family: inherit;
          background: #f8fafc;
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
