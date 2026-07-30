"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "leaflet/dist/leaflet.css";
import {
  Circle,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import {
  createLeafletContext,
  LeafletProvider,
  type LeafletContextInterface,
} from "@react-leaflet/core";

import {
  getGuardLocationHealth,
  guardLocationHealthLabel,
  guardLocationUpdatedAt,
  type GuardLocationHealth,
} from "@/lib/guard-location-status";
import type { GuardLocation } from "@/types/guard-location";

const GUARD_ICON_SVG = (color: string) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48" width="32" height="48" role="img" aria-label="Guard location">
  <circle cx="16" cy="14" r="12" fill="${color}" stroke="white" stroke-width="2"/>
  <path d="M16 48 L16 24" stroke="${color}" stroke-width="3"/>
  <circle cx="16" cy="14" r="4" fill="white" opacity="0.75"/>
</svg>`;

export const STATUS_COLORS: Record<GuardLocationHealth, string> = {
  live: "#16a34a",
  out_of_zone: "#dc2626",
  poor_accuracy: "#7c3aed",
  delayed: "#d97706",
  stale: "#6b7280",
};

export type MapViewportRequest = {
  type: "fit_all" | "fit_alerts" | "reset";
  nonce: number;
};

type GuardMarker = {
  location: GuardLocation;
  health: GuardLocationHealth;
  color: string;
  icon: L.DivIcon;
};

type SiteSummary = {
  key: string;
  name: string;
  clientName: string;
  lat: number;
  lng: number;
  radius?: number;
  guards: number;
  alerts: number;
};

function StableMapContainer({ children }: { children: React.ReactNode }) {
  const mapInstanceRef = useRef<L.Map | null>(null);
  const cleanupTimerRef = useRef<number | null>(null);
  const [context, setContext] = useState<LeafletContextInterface | null>(null);

  const attachMap = useCallback((node: HTMLDivElement | null) => {
    if (!node || mapInstanceRef.current) return;
    const map = new L.Map(node, { scrollWheelZoom: true });
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    mapInstanceRef.current = map;
    setContext(createLeafletContext(map));
  }, []);

  useEffect(() => {
    if (cleanupTimerRef.current) {
      window.clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }
    return () => {
      // Defer teardown so React's development-only strict effect replay can reuse the map.
      cleanupTimerRef.current = window.setTimeout(() => {
        mapInstanceRef.current?.remove();
        mapInstanceRef.current = null;
      }, 0);
    };
  }, []);

  return (
    <div ref={attachMap} className="h-full w-full rounded-xl">
      {context ? (
        <LeafletProvider value={context}>{children}</LeafletProvider>
      ) : null}
    </div>
  );
}

function createGuardIcon(color: string) {
  return L.divIcon({
    className: "",
    html: GUARD_ICON_SVG(color),
    iconSize: [32, 48],
    iconAnchor: [16, 48],
    popupAnchor: [0, -48],
  });
}

function createClusterIcon(count: number, alerts: number) {
  const color = alerts > 0 ? "#dc2626" : "#0f2747";
  return L.divIcon({
    className: "",
    html: `<div role="img" aria-label="${count} guards${alerts ? `, ${alerts} alerts` : ""}" style="width:44px;height:44px;border-radius:9999px;background:${color};border:3px solid white;box-shadow:0 4px 16px rgba(15,39,71,.35);display:grid;place-items:center;color:white;font:700 13px system-ui">${count}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

function createSiteIcon(alerts: number) {
  const color = alerts > 0 ? "#dc2626" : "#b58b32";
  return L.divIcon({
    className: "",
    html: `<div role="img" aria-label="Site${alerts ? " with guard alert" : ""}" style="width:20px;height:20px;transform:rotate(45deg);background:${color};border:3px solid white;box-shadow:0 2px 8px rgba(15,39,71,.35);border-radius:4px"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function fitLocations(map: L.Map, locations: GuardLocation[]) {
  if (locations.length === 0) return;
  if (locations.length === 1) {
    map.setView([locations[0].lat, locations[0].lng], 15);
    return;
  }
  map.fitBounds(
    L.latLngBounds(locations.map((location) => [location.lat, location.lng])),
    { padding: [44, 44], maxZoom: 15 },
  );
}

function MapViewport({
  locations,
  selectedEmployeeDocId,
  scopeKey,
  viewportRequest,
  resizeSignal,
  now,
}: {
  locations: GuardLocation[];
  selectedEmployeeDocId?: string | null;
  scopeKey: string;
  viewportRequest?: MapViewportRequest;
  resizeSignal?: number;
  now: Date;
}) {
  const map = useMap();
  const locationsRef = useRef(locations);
  locationsRef.current = locations;

  useEffect(() => {
    fitLocations(map, locationsRef.current);
  }, [map, scopeKey]);

  const selected = locations.find(
    (location) => location.employeeDocId === selectedEmployeeDocId,
  );
  const selectedLat = selected?.lat;
  const selectedLng = selected?.lng;

  useEffect(() => {
    if (selectedLat == null || selectedLng == null) return;
    map.flyTo([selectedLat, selectedLng], Math.max(map.getZoom(), 16));
  }, [map, selectedEmployeeDocId, selectedLat, selectedLng]);

  useEffect(() => {
    if (!viewportRequest) return;
    if (viewportRequest.type === "reset") {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }
    const target =
      viewportRequest.type === "fit_alerts"
        ? locationsRef.current.filter(
            (location) => getGuardLocationHealth(location, now) !== "live",
          )
        : locationsRef.current;
    fitLocations(map, target.length > 0 ? target : locationsRef.current);
  }, [map, now, viewportRequest]);

  useEffect(() => {
    const timeout = window.setTimeout(() => map.invalidateSize(), 80);
    return () => window.clearTimeout(timeout);
  }, [map, resizeSignal]);

  return null;
}

function ClusteredGuardMarkers({
  markers,
  onSelectGuard,
}: {
  markers: GuardMarker[];
  onSelectGuard?: (location: GuardLocation) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
    moveend: () => setZoom(map.getZoom()),
  });

  const clusters = useMemo(() => {
    if (zoom >= 17) return markers.map((marker) => [marker]);
    const cellSize = zoom <= 10 ? 72 : zoom <= 13 ? 62 : 52;
    const groups = new Map<string, GuardMarker[]>();
    markers.forEach((marker) => {
      const point = map.project(
        [marker.location.lat, marker.location.lng],
        zoom,
      );
      const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
      const group = groups.get(key) ?? [];
      group.push(marker);
      groups.set(key, group);
    });
    return [...groups.values()];
  }, [map, markers, zoom]);

  return (
    <>
      {clusters.map((cluster) => {
        if (cluster.length > 1) {
          const alerts = cluster.filter(({ health }) => health !== "live").length;
          const bounds = L.latLngBounds(
            cluster.map(({ location }) => [location.lat, location.lng]),
          );
          const center = bounds.getCenter();
          return (
            <Marker
              key={`cluster-${zoom}-${cluster.map(({ location }) => location.employeeDocId).join("-")}`}
              position={center}
              icon={createClusterIcon(cluster.length, alerts)}
              eventHandlers={{
                click: () =>
                  map.fitBounds(bounds, {
                    padding: [50, 50],
                    maxZoom: Math.min(18, zoom + 3),
                  }),
              }}
            >
              <Tooltip direction="top">
                {cluster.length} guards{alerts > 0 ? ` · ${alerts} need attention` : ""}
              </Tooltip>
            </Marker>
          );
        }

        const { location, health, color, icon } = cluster[0];
        const updatedAt = guardLocationUpdatedAt(location);
        return (
          <React.Fragment key={location.employeeDocId}>
            {Number.isFinite(location.accuracy) && location.accuracy > 0 ? (
              <Circle
                center={[location.lat, location.lng]}
                radius={location.accuracy}
                pathOptions={{
                  color: "#2563eb",
                  fillColor: "#60a5fa",
                  fillOpacity: 0.08,
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
    </>
  );
}

const DEFAULT_CENTER: [number, number] = [10.5, 76.5];
const DEFAULT_ZOOM = 8;

export function LiveGuardMap({
  locations,
  selectedEmployeeDocId,
  now,
  scopeKey,
  viewportRequest,
  resizeSignal,
  onSelectGuard,
}: {
  locations: GuardLocation[];
  selectedEmployeeDocId?: string | null;
  now: Date;
  scopeKey?: string;
  viewportRequest?: MapViewportRequest;
  resizeSignal?: number;
  onSelectGuard?: (location: GuardLocation) => void;
}) {
  const markers = useMemo<GuardMarker[]>(
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

  const sites = useMemo<SiteSummary[]>(() => {
    const grouped = new Map<string, SiteSummary>();
    markers.forEach(({ location, health }) => {
      if (
        !Number.isFinite(location.siteLat) ||
        !Number.isFinite(location.siteLng)
      ) {
        return;
      }
      const key =
        location.siteId ||
        `${location.siteName}-${location.siteLat}-${location.siteLng}`;
      const current = grouped.get(key);
      if (current) {
        current.guards += 1;
        if (health !== "live") current.alerts += 1;
        current.radius = Math.max(
          current.radius ?? 0,
          location.geofenceRadius ?? 0,
        ) || undefined;
        return;
      }
      grouped.set(key, {
        key,
        name: location.siteName || "Unnamed site",
        clientName: location.clientName || "",
        lat: location.siteLat as number,
        lng: location.siteLng as number,
        radius: location.geofenceRadius,
        guards: 1,
        alerts: health === "live" ? 0 : 1,
      });
    });
    return [...grouped.values()];
  }, [markers]);

  return (
    <StableMapContainer>
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
        scopeKey={scopeKey ?? "all"}
        viewportRequest={viewportRequest}
        resizeSignal={resizeSignal}
        now={now}
      />
      {sites.map((site) => (
        <React.Fragment key={site.key}>
          {site.radius ? (
            <Circle
              center={[site.lat, site.lng]}
              radius={site.radius}
              pathOptions={{
                color: site.alerts > 0 ? "#dc2626" : "#b58b32",
                fillColor: site.alerts > 0 ? "#dc2626" : "#b58b32",
                fillOpacity: 0.04,
                weight: 1.5,
                dashArray: "5 5",
              }}
            />
          ) : null}
          <Marker
            position={[site.lat, site.lng]}
            icon={createSiteIcon(site.alerts)}
            zIndexOffset={-500}
          >
            <Tooltip direction="top">
              {site.name} · {site.guards} on duty
            </Tooltip>
            <Popup>
              <div className="min-w-40 space-y-1 text-xs">
                <p className="font-semibold">{site.name}</p>
                {site.clientName ? <p>{site.clientName}</p> : null}
                <p>{site.guards} guard{site.guards === 1 ? "" : "s"} on duty</p>
                <p style={{ color: site.alerts > 0 ? "#dc2626" : "#16a34a" }}>
                  {site.alerts > 0
                    ? `${site.alerts} need attention`
                    : "All reporting normally"}
                </p>
              </div>
            </Popup>
          </Marker>
        </React.Fragment>
      ))}
      <ClusteredGuardMarkers
        markers={markers}
        onSelectGuard={onSelectGuard}
      />
    </StableMapContainer>
  );
}
