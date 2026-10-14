// apps/web/components/dashboard/TransactionMap.tsx
// Leaflet map for transaction geolocation
// MUST be dynamically imported with ssr: false — Leaflet requires window
'use client';

import { useEffect, useRef } from 'react';

interface MapMarker {
  lat: number;
  lng: number;
  type: 'current' | 'previous' | 'warning';
  label?: string;
}

interface TransactionMapProps {
  markers: MapMarker[];
  center?: [number, number];
  zoom?: number;
}

export default function TransactionMap({
  markers,
  center,
  zoom = 5,
}: TransactionMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    let isCanceled = false;

    if (!mapRef.current || mapInstanceRef.current) return;

    // Dynamically import Leaflet to avoid SSR issues
    import('leaflet').then(L => {
      if (isCanceled || !mapRef.current) return;

      // Clear existing Leaflet ID if DOM node was reused
      if ((mapRef.current as any)._leaflet_id) {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
        } else {
          (mapRef.current as any)._leaflet_id = null;
        }
      }

      if (mapInstanceRef.current) return;

      // Fix default marker icons (Leaflet webpack issue)
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      // Calculate center from markers if not provided
      const mapCenter: [number, number] = center || (
        markers.length > 0
          ? [markers[0].lat, markers[0].lng]
          : [20, 0]
      );

      // Create map with dark tile style
      const map = L.map(mapRef.current, {
        center: mapCenter,
        zoom,
        zoomControl: true,
        attributionControl: false,
      });

      // Dark OpenStreetMap tiles (Stadia dark theme — free, no API key)
      L.tileLayer(
        'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
        {
          maxZoom: 19,
          attribution: '© Stadia Maps © OpenMapTiles © OpenStreetMap',
        }
      ).addTo(map);

      // ── Consistent marker system ───────────────────────────────
      // Current transaction: always a prominent red/coral circular
      //   marker with a pulsing glow ring — regardless of risk level
      //   or whether the transaction triggered a geo-anomaly.
      // Previous locations: brighter steel-blue circles with a
      //   visible outline, clearly secondary but readable on dark tiles.
      markers.forEach(marker => {
        let markerIcon: L.DivIcon;

        if (marker.type === 'current' || marker.type === 'warning') {
          // ── Current transaction: prominent red/coral circle + glow ring ──
          // Consistent across all risk levels — anomaly status is
          // communicated in the map header badge, not the marker shape.
          markerIcon = L.divIcon({
            className: '',
            html: `
              <div style="position: relative; width: 22px; height: 22px;">
                <div style="
                  position: absolute; inset: -4px;
                  background: rgba(239,68,68,0.15);
                  border-radius: 50%;
                  animation: marker-pulse 2s ease-out infinite;
                "></div>
                <div style="
                  position: absolute; inset: 0;
                  background: #EF4444;
                  border-radius: 50%;
                  border: 2.5px solid #FCA5A5;
                  box-shadow: 0 0 8px 2px rgba(239,68,68,0.35),
                              0 0 0 4px rgba(239,68,68,0.12);
                "></div>
              </div>
            `,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });
        } else {
          // ── Previous locations: steel-blue circle with visible outline ──
          markerIcon = L.divIcon({
            className: '',
            html: `
              <div style="
                width: 13px; height: 13px;
                background: #6B8DB5;
                border-radius: 50%;
                border: 2px solid #93B4D4;
                box-shadow: 0 0 4px 1px rgba(107,141,181,0.25);
              "></div>
            `,
            iconSize: [13, 13],
            iconAnchor: [7, 7],
          });
        }

        const leafletMarker = L.marker([marker.lat, marker.lng], {
          icon: markerIcon,
        });

        if (marker.label) {
          leafletMarker.bindTooltip(marker.label, {
            permanent: false,
            direction: 'top',
            className: 'leaflet-dark-tooltip',
          });
        }

        leafletMarker.addTo(map);
      });

      // Fit bounds to show all markers if multiple
      if (markers.length > 1) {
        const bounds = L.latLngBounds(
          markers.map(m => [m.lat, m.lng] as [number, number])
        );
        map.fitBounds(bounds, { padding: [30, 30] });
      }

      mapInstanceRef.current = map;
    });

    return () => {
      isCanceled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Leaflet CSS */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      />
      <div
        ref={mapRef}
        className="w-full h-full rounded-lg overflow-hidden"
        style={{ minHeight: 200 }}
      />
      <style>{`
        .leaflet-dark-tooltip {
          background: #131929;
          border: 1px solid #2A3148;
          color: #E5E7EB;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          padding: 5px 10px;
          border-radius: 6px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.6);
        }
        .leaflet-dark-tooltip::before {
          border-top-color: #2A3148;
        }
        .leaflet-control-zoom a {
          background: #131929 !important;
          color: #9CA0B8 !important;
          border-color: #2A3148 !important;
          cursor: pointer !important;
          transition: background 150ms, color 150ms !important;
        }
        .leaflet-control-zoom a:hover {
          background: #1E2535 !important;
          color: #E5E7EB !important;
        }
        @keyframes marker-pulse {
          0%   { transform: scale(1);   opacity: 0.6; }
          70%  { transform: scale(2.2); opacity: 0; }
          100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>
    </>
  );
}