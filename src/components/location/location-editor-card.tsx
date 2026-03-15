"use client";

import { useMemo, useState } from "react";
import { GeoPoint } from "firebase/firestore";
import { Loader2, LocateFixed, MapPinned, Navigation, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  buildGoogleMapsLink,
  buildOsmEmbedUrl,
  coordinateSourceLabels,
  coordinateStatusLabels,
  deriveCoordinateSource,
  deriveCoordinateStatus,
  formatCoordinate,
  hasValidCoordinates,
} from "@/lib/location-utils";
import type {
  CoordinateSource,
  CoordinateStatus,
  GeoPointLike,
} from "@/types/location";

type LocationEditorValue = {
  address: string;
  district?: string;
  geolocation?: GeoPointLike;
  latString?: string;
  lngString?: string;
  coordinateStatus?: CoordinateStatus;
  coordinateSource?: CoordinateSource;
  placeAccuracy?: string | null;
};

type Props = {
  value: LocationEditorValue;
  onChange: (patch: Partial<LocationEditorValue>) => void;
  entityType: "site" | "clientLocation";
  title?: string;
  description?: string;
};

export function LocationEditorCard({
  value,
  onChange,
  entityType,
  title = "Coordinates",
  description = "Use address lookup first, then verify or override only if needed.",
}: Props) {
  const { toast } = useToast();
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [showManualInputs, setShowManualInputs] = useState(false);

  const latitude = value.geolocation?.latitude;
  const longitude = value.geolocation?.longitude;
  const hasCoords = hasValidCoordinates(value.geolocation);
  const status = deriveCoordinateStatus(value);
  const source = deriveCoordinateSource(value);

  const googleMapsLink = useMemo(
    () => buildGoogleMapsLink(latitude, longitude, value.address),
    [latitude, longitude, value.address],
  );
  const osmEmbedUrl = useMemo(
    () => buildOsmEmbedUrl(latitude, longitude),
    [latitude, longitude],
  );

  const applyCoordinates = (
    latitudeValue: number,
    longitudeValue: number,
    nextSource: CoordinateSource,
    nextStatus: CoordinateStatus,
    placeAccuracy?: string | null,
    nextAddress?: string,
  ) => {
    onChange({
      geolocation: new GeoPoint(latitudeValue, longitudeValue) as unknown as GeoPointLike,
      latString: formatCoordinate(latitudeValue),
      lngString: formatCoordinate(longitudeValue),
      coordinateSource: nextSource,
      coordinateStatus: nextStatus,
      placeAccuracy: placeAccuracy ?? value.placeAccuracy ?? undefined,
      ...(nextAddress ? { address: nextAddress } : {}),
    });
  };

  const handleGeocode = async () => {
    if (!value.address.trim()) {
      toast({
        variant: "destructive",
        title: "Address required",
        description: "Enter the address first so we can look up the coordinates.",
      });
      return;
    }

    setIsGeocoding(true);
    try {
      const response = await fetch("/api/locations/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: value.address,
          district: value.district,
          entityType,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not geocode this address.");
      }

      applyCoordinates(
        data.lat,
        data.lng,
        "geocode",
        hasCoords ? "overridden" : "geocoded",
        data.placeAccuracy ?? null,
        data.formattedAddress,
      );
      toast({
        title: "Coordinates updated",
        description: "The address was geocoded successfully.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Geocoding failed",
        description: error?.message || "Could not fetch coordinates for this address.",
      });
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleUseCurrentLocation = async () => {
    if (!navigator.geolocation) {
      toast({
        variant: "destructive",
        title: "Location unavailable",
        description: "This browser does not support location access.",
      });
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const response = await fetch("/api/locations/geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reverse: true,
              entityType,
              coordinates: { lat, lng },
            }),
          });
          const data = await response.json().catch(() => ({}));

          applyCoordinates(
            lat,
            lng,
            "current_location",
            hasCoords ? "overridden" : "verified",
            typeof position.coords.accuracy === "number"
              ? `GPS accuracy ±${Math.round(position.coords.accuracy)}m`
              : data.placeAccuracy ?? null,
            data.formattedAddress,
          );
          toast({
            title: "Current location captured",
            description: "The coordinates and nearby address have been applied.",
          });
        } catch (error: any) {
          toast({
            variant: "destructive",
            title: "Location lookup failed",
            description:
              error?.message || "The browser location was captured, but address lookup failed.",
          });
        } finally {
          setIsLocating(false);
        }
      },
      (error) => {
        setIsLocating(false);
        toast({
          variant: "destructive",
          title: "Location permission needed",
          description:
            error.message || "Please allow location access and try again.",
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const updateManualCoordinates = (nextLatText: string, nextLngText: string) => {
    const nextLat = Number.parseFloat(nextLatText);
    const nextLng = Number.parseFloat(nextLngText);
    onChange({
      latString: nextLatText,
      lngString: nextLngText,
    });
    if (
      Number.isFinite(nextLat) &&
      nextLat >= -90 &&
      nextLat <= 90 &&
      Number.isFinite(nextLng) &&
      nextLng >= -180 &&
      nextLng <= 180
    ) {
      applyCoordinates(nextLat, nextLng, "manual", hasCoords ? "overridden" : "verified");
    }
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={status === "missing" ? "destructive" : "outline"}>
              {coordinateStatusLabels[status]}
            </Badge>
            {source ? (
              <Badge variant="secondary">{coordinateSourceLabels[source]}</Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor={`${entityType}-address`}>Address</Label>
          <Textarea
            id={`${entityType}-address`}
            value={value.address}
            onChange={(event) => onChange({ address: event.target.value })}
            rows={3}
            placeholder="Enter the full address for this location"
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" variant="outline" onClick={handleGeocode} disabled={isGeocoding}>
            {isGeocoding ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MapPinned className="mr-2 h-4 w-4" />
            )}
            Geocode address
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleUseCurrentLocation}
            disabled={isLocating}
          >
            {isLocating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LocateFixed className="mr-2 h-4 w-4" />
            )}
            Use current location
          </Button>
          {googleMapsLink ? (
            <Button type="button" variant="outline" asChild>
              <a href={googleMapsLink} target="_blank" rel="noreferrer">
                <Navigation className="mr-2 h-4 w-4" />
                Open in Maps
              </a>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowManualInputs((current) => !current)}
          >
            {showManualInputs ? "Hide manual entry" : "Manual coordinates"}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Latitude
            </p>
            <p className="text-sm font-semibold">
              {hasCoords ? formatCoordinate(latitude) : "Not set"}
            </p>
          </div>
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Longitude
            </p>
            <p className="text-sm font-semibold">
              {hasCoords ? formatCoordinate(longitude) : "Not set"}
            </p>
          </div>
        </div>

        {showManualInputs ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${entityType}-lat-manual`}>Latitude</Label>
              <Input
                id={`${entityType}-lat-manual`}
                value={value.latString ?? ""}
                placeholder="10.123456"
                onChange={(event) =>
                  updateManualCoordinates(event.target.value, value.lngString ?? "")
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${entityType}-lng-manual`}>Longitude</Label>
              <Input
                id={`${entityType}-lng-manual`}
                value={value.lngString ?? ""}
                placeholder="76.123456"
                onChange={(event) =>
                  updateManualCoordinates(value.latString ?? "", event.target.value)
                }
              />
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Coordinate status</Label>
            <Select
              value={status}
              onValueChange={(nextValue: CoordinateStatus) =>
                onChange({ coordinateStatus: nextValue })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(coordinateStatusLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Coordinate source</Label>
            <Select
              value={source ?? "manual"}
              onValueChange={(nextValue: CoordinateSource) =>
                onChange({ coordinateSource: nextValue })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(coordinateSourceLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor={`${entityType}-accuracy`}>Verification note</Label>
          <Input
            id={`${entityType}-accuracy`}
            value={value.placeAccuracy ?? ""}
            placeholder="Example: OpenCage confidence 8 / GPS accuracy ±12m"
            onChange={(event) => onChange({ placeAccuracy: event.target.value })}
          />
        </div>

        {hasCoords ? (
          <div className="space-y-3 rounded-xl border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold">Map preview</p>
                <p className="text-xs text-muted-foreground">
                  Use this to visually verify the saved pin before you save.
                </p>
              </div>
              <Badge variant="outline">
                <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                {coordinateStatusLabels[status]}
              </Badge>
            </div>
            {osmEmbedUrl ? (
              <div className="overflow-hidden rounded-lg border">
                <iframe
                  title={`${entityType} map preview`}
                  src={osmEmbedUrl}
                  className="h-56 w-full bg-muted"
                  loading="lazy"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
