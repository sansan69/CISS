"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";

type Props = {
  latitude?: number | null;
  longitude?: number | null;
  onSelect: (lat: number, lng: number) => void;
};

const DEFAULT_CENTER: [number, number] = [11.1271, 78.6569];
const DEFAULT_ZOOM = 6;
const FOCUSED_ZOOM = 16;

const markerIcon = L.divIcon({
  className: "location-picker-pin",
  html: '<span class="location-picker-pin__dot"></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

export function LocationPickerMap({ latitude, longitude, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const latestOnSelectRef = useRef(onSelect);

  latestOnSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView(
      latitude != null && longitude != null ? [latitude, longitude] : DEFAULT_CENTER,
      latitude != null && longitude != null ? FOCUSED_ZOOM : DEFAULT_ZOOM,
    );

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    map.on("click", (event) => {
      const nextLat = Number(event.latlng.lat.toFixed(6));
      const nextLng = Number(event.latlng.lng.toFixed(6));
      latestOnSelectRef.current(nextLat, nextLng);
    });

    mapRef.current = map;

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (latitude == null || longitude == null) {
      markerRef.current?.remove();
      markerRef.current = null;
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }

    const latLng = L.latLng(latitude, longitude);

    if (!markerRef.current) {
      const marker = L.marker(latLng, {
        draggable: true,
        icon: markerIcon,
      });

      marker.on("dragend", () => {
        const nextPosition = marker.getLatLng();
        latestOnSelectRef.current(
          Number(nextPosition.lat.toFixed(6)),
          Number(nextPosition.lng.toFixed(6)),
        );
      });

      marker.addTo(map);
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng(latLng);
    }

    map.setView(latLng, Math.max(map.getZoom(), FOCUSED_ZOOM));
  }, [latitude, longitude]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="location-picker-map" />
      <p className="text-xs text-muted-foreground">
        Click anywhere on the map to place the pin, or drag the pin to fine-tune the saved GPS point.
      </p>
    </div>
  );
}
