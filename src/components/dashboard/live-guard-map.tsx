"use client";

import React, { useMemo } from "react";
import { MapContainer, TileLayer, Marker, Circle, Popup, Tooltip } from "react-leaflet";
import L from "leaflet";
import type { GuardLocation } from "@/types/guard-location";

const GUARD_ICON_SVG = (color: string) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48" width="32" height="48">
  <circle cx="16" cy="14" r="12" fill="${color}" stroke="white" stroke-width="2"/>
  <path d="M16 48 L16 24" stroke="${color}" stroke-width="3"/>
  <circle cx="16" cy="14" r="4" fill="white" opacity="0.6"/>
</svg>`;

function createGuardIcon(color: string) {
  return L.divIcon({
    className: "",
    html: GUARD_ICON_SVG(color),
    iconSize: [32, 48],
    iconAnchor: [16, 48],
    popupAnchor: [0, -48],
  });
}

function getGuardColor(loc: GuardLocation): string {
  const updated = loc.updatedAt?.toDate?.() ?? new Date();
  const staleMs = Date.now() - updated.getTime();
  if (loc.isOutOfZone) return "#ef4444";
  if (staleMs > 10 * 60 * 1000) return "#6b7280";
  if (staleMs > 5 * 60 * 1000) return "#f59e0b";
  return "#22c55e";
}

const DEFAULT_CENTER: [number, number] = [10.5, 76.5];
const DEFAULT_ZOOM = 8;

export function LiveGuardMap({
  locations,
  onSelectGuard,
}: {
  locations: GuardLocation[];
  onSelectGuard?: (loc: GuardLocation) => void;
}) {
  const markers = useMemo(
    () =>
      locations.map((loc) => ({
        loc,
        color: getGuardColor(loc),
        icon: createGuardIcon(getGuardColor(loc)),
      })),
    [locations],
  );

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      className="h-full w-full rounded-xl"
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {markers.map(({ loc, color, icon }) => {
        const updated = loc.updatedAt?.toDate?.() ?? new Date();
        const isStale = Date.now() - updated.getTime() > 10 * 60 * 1000;
        return (
          <React.Fragment key={loc.employeeDocId}>
            {/* Geofence circle */}
            {loc.siteLat != null && loc.siteLng != null && loc.geofenceRadius ? (
              <Circle
                center={[loc.siteLat, loc.siteLng]}
                radius={loc.geofenceRadius}
                pathOptions={{
                  color: loc.isOutOfZone ? "#ef4444" : "#22c55e",
                  fillColor: loc.isOutOfZone ? "#ef4444" : "#22c55e",
                  fillOpacity: 0.05,
                  weight: 1,
                  dashArray: "4 4",
                }}
              />
            ) : null}
            {/* Guard marker */}
            <Marker
              position={[loc.lat, loc.lng]}
              icon={icon}
              eventHandlers={{
                click: () => onSelectGuard?.(loc),
              }}
            >
              <Tooltip direction="top" offset={[0, -48]}>
                <div className="text-xs font-medium">{loc.guardName}</div>
                <div className="text-[10px] text-muted-foreground">
                  {loc.siteName}
                  {isStale ? " (stale)" : loc.isOutOfZone ? " (out of zone)" : ""}
                </div>
              </Tooltip>
            </Marker>
          </React.Fragment>
        );
      })}
    </MapContainer>
  );
}
