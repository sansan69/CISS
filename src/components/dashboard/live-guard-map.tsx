"use client";

import React, { useEffect, useMemo } from "react";
import "leaflet/dist/leaflet.css";
import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";

import {
  getGuardLocationHealth,
  guardLocationHealthLabel,
  guardLocationUpdatedAt,
} from "@/lib/guard-location-status";
import type { GuardLocation } from "@/types/guard-location";

const GUARD_ICON_SVG = (color: string) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48" width="32" height="48" role="img" aria-label="Guard location">
  <circle cx="16" cy="14" r="12" fill="${color}" stroke="white" stroke-width="2"/>
  <path d="M16 48 L16 24" stroke="${color}" stroke-width="3"/>
  <circle cx="16" cy="14" r="4" fill="white" opacity="0.75"/>
</svg>`;

const STATUS_COLORS = {
  live: "#16a34a",
  out_of_zone: "#dc2626",
  poor_accuracy: "#7c3aed",
  delayed: "#d97706",
  stale: "#6b7280",
} as const;

function createGuardIcon(color: string) {
  return L.divIcon({
    className: "",
    html: GUARD_ICON_SVG(color),
    iconSize: [32, 48],
    iconAnchor: [16, 48],
    popupAnchor: [0, -48],
  });
}

function MapViewport({
  locations,
  selectedEmployeeDocId,
}: {
  locations: GuardLocation[];
  selectedEmployeeDocId?: string | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (locations.length === 0) return;
    if (locations.length === 1) {
      map.setView([locations[0].lat, locations[0].lng], 15);
      return;
    }
    map.fitBounds(
      L.latLngBounds(locations.map((location) => [location.lat, location.lng])),
      { padding: [36, 36], maxZoom: 15 },
    );
  }, [locations, map]);

  useEffect(() => {
    const selected = locations.find(
      (location) => location.employeeDocId === selectedEmployeeDocId,
    );
    if (selected) map.flyTo([selected.lat, selected.lng], Math.max(map.getZoom(), 16));
  }, [locations, map, selectedEmployeeDocId]);

  return null;
}

const DEFAULT_CENTER: [number, number] = [10.5, 76.5];
const DEFAULT_ZOOM = 8;

export function LiveGuardMap({
  locations,
  selectedEmployeeDocId,
  now,
  onSelectGuard,
}: {
  locations: GuardLocation[];
  selectedEmployeeDocId?: string | null;
  now: Date;
  onSelectGuard?: (location: GuardLocation) => void;
}) {
  const markers = useMemo(
    () =>
      locations.map((location) => {
        const health = getGuardLocationHealth(location, now);
        const color = STATUS_COLORS[health];
        return {
          location,
          health,
          color,
          icon: createGuardIcon(color),
        };
      }),
    [locations, now],
  );

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      className="h-full w-full rounded-xl"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url={
          process.env.NEXT_PUBLIC_MAP_TILE_URL ||
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        }
      />
      <MapViewport
        locations={locations}
        selectedEmployeeDocId={selectedEmployeeDocId}
      />
      {markers.map(({ location, health, color, icon }) => {
        const updatedAt = guardLocationUpdatedAt(location);
        return (
          <React.Fragment key={location.employeeDocId}>
            {location.siteLat != null &&
            location.siteLng != null &&
            location.geofenceRadius ? (
              <Circle
                center={[location.siteLat, location.siteLng]}
                radius={location.geofenceRadius}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.04,
                  weight: 1,
                  dashArray: "4 4",
                }}
              />
            ) : null}
            {Number.isFinite(location.accuracy) && location.accuracy > 0 ? (
              <Circle
                center={[location.lat, location.lng]}
                radius={location.accuracy}
                pathOptions={{
                  color: "#2563eb",
                  fillColor: "#60a5fa",
                  fillOpacity: 0.1,
                  weight: 1,
                }}
              />
            ) : null}
            <Marker
              position={[location.lat, location.lng]}
              icon={icon}
              eventHandlers={{ click: () => onSelectGuard?.(location) }}
            >
              <Tooltip direction="top" offset={[0, -48]}>
                <div className="text-xs font-semibold">{location.guardName}</div>
                <div className="text-[10px]">
                  {location.siteName} · {guardLocationHealthLabel(health)}
                </div>
              </Tooltip>
              <Popup>
                <div className="min-w-44 space-y-1 text-xs">
                  <p className="font-semibold">{location.guardName}</p>
                  <p>{location.siteName}</p>
                  <p style={{ color }}>{guardLocationHealthLabel(health)}</p>
                  <p>
                    Accuracy ±{Math.round(location.accuracy)} m
                    {typeof location.distanceFromSite === "number"
                      ? ` · ${Math.round(location.distanceFromSite)} m from site`
                      : ""}
                  </p>
                  <p>
                    {updatedAt
                      ? `Updated ${updatedAt.toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : "Update time unavailable"}
                  </p>
                </div>
              </Popup>
            </Marker>
          </React.Fragment>
        );
      })}
    </MapContainer>
  );
}
