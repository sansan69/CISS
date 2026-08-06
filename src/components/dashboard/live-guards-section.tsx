"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { db } from "@/lib/firebase";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowSquareOut,
  ArrowsOut,
  BatteryHigh,
  Clock,
  Crosshair,
  Funnel,
  List,
  MagnifyingGlass as Search,
  MapPin,
  MapTrifold as MapIcon,
  Speedometer,
  Warning as AlertTriangle,
  WifiSlash as WifiOff,
  X,
} from "@phosphor-icons/react";
import {
  getGuardLocationHealth,
  guardLocationHealthLabel,
  guardLocationUpdatedAt,
  type GuardLocationHealth,
} from "@/lib/guard-location-status";
import type { GuardLocation } from "@/types/guard-location";
import type { MapViewportRequest } from "@/components/dashboard/live-guard-map";

const LiveGuardMap = dynamic(
  () => import("@/components/dashboard/live-guard-map").then((mod) => ({ default: mod.LiveGuardMap })),
  { ssr: false },
);

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function LiveGuardsSection({
  districts,
  clientName,
}: {
  districts?: string[];
  clientName?: string;
}) {
  const [locations, setLocations] = useState<GuardLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedEmployeeDocId, setSelectedEmployeeDocId] = useState<string | null>(null);
  const [healthFilter, setHealthFilter] = useState<"all" | GuardLocationHealth>("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewportRequest, setViewportRequest] = useState<MapViewportRequest>();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const intervalId = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let q = query(
      collection(db, "guardLocations"),
      where("status", "==", "In")
    );
    const scopedDistricts = (districts ?? [])
      .map((district) => district.trim())
      .filter(Boolean)
      .slice(0, 30);
    if (scopedDistricts.length === 1) {
      q = query(q, where("district", "==", scopedDistricts[0]));
    } else if (scopedDistricts.length > 1) {
      q = query(q, where("district", "in", scopedDistricts));
    }
    if (clientName && clientName.trim()) {
      q = query(q, where("clientName", "==", clientName.trim()));
    }
    // Keep the live map responsive on large deployments. The freshest
    // locations are the useful ones; opening the full list can still be done
    // from the dedicated attendance/location views.
    q = query(q, orderBy("updatedAt", "desc"), limit(250));

    const unsub = onSnapshot(
      q,
      (snap) => {
        setLocationsError(null);
        const locs: GuardLocation[] = [];
        snap.forEach((doc) => {
          const data = doc.data() as GuardLocation;
          if (
            Number.isFinite(data.lat) &&
            data.lat >= -90 &&
            data.lat <= 90 &&
            Number.isFinite(data.lng) &&
            data.lng >= -180 &&
            data.lng <= 180
          ) {
            locs.push({
              ...data,
              employeeDocId: data.employeeDocId || doc.id,
            });
          }
        });
        locs.sort((a, b) => {
          const aTime = guardLocationUpdatedAt(a)?.getTime() ?? 0;
          const bTime = guardLocationUpdatedAt(b)?.getTime() ?? 0;
          return bTime - aTime;
        });
        setLocations(locs);
        setLocationsLoading(false);
      },
      (err) => {
        console.error("LiveGuardsSection error:", err);
        setLocationsError(
          "Live locations could not be loaded. Check access and try refreshing.",
        );
        setLocationsLoading(false);
      }
    );

    return () => unsub();
  }, [districts, clientName]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

  const loading = locationsLoading;

  const markedInLocations = useMemo(() => {
    return locations.filter((location) => location.status === "In");
  }, [locations]);

  const onDuty = markedInLocations.length;
  const healthFor = (location: GuardLocation) =>
    getGuardLocationHealth(location, now);
  const outOfZone = markedInLocations.filter(
    (location) => healthFor(location) === "out_of_zone",
  ).length;
  const stale = markedInLocations.filter(
    (location) => healthFor(location) === "stale",
  ).length;
  const delayed = markedInLocations.filter(
    (location) => healthFor(location) === "delayed",
  ).length;
  const poorAccuracy = markedInLocations.filter(
    (location) => healthFor(location) === "poor_accuracy",
  ).length;
  const inZone = markedInLocations.filter(
    (location) => healthFor(location) === "live",
  ).length;

  const filterOptions = useMemo(
    () => ({
      districts: [...new Set(markedInLocations.map((location) => location.district).filter(Boolean))].sort(),
      clients: [...new Set(markedInLocations.map((location) => location.clientName).filter(Boolean))].sort(),
      sites: [...new Map(
        markedInLocations
          .filter((location) => location.siteName)
          .map((location) => [location.siteId || location.siteName, location.siteName]),
      ).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    }),
    [markedInLocations],
  );

  const filteredLocations = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return markedInLocations.filter((location) => {
      const health = getGuardLocationHealth(location, now);
      const matchesSearch =
        !normalizedSearch ||
        location.guardName?.toLowerCase().includes(normalizedSearch) ||
        location.employeeId?.toLowerCase().includes(normalizedSearch) ||
        location.siteName?.toLowerCase().includes(normalizedSearch) ||
        location.district?.toLowerCase().includes(normalizedSearch);
      return (
        matchesSearch &&
        (healthFilter === "all" || health === healthFilter) &&
        (districtFilter === "all" || location.district === districtFilter) &&
        (clientFilter === "all" || location.clientName === clientFilter) &&
        (siteFilter === "all" ||
          (location.siteId || location.siteName) === siteFilter)
      );
    });
  }, [
    markedInLocations,
    searchTerm,
    healthFilter,
    districtFilter,
    clientFilter,
    siteFilter,
    now,
  ]);

  const selectedGuard =
    filteredLocations.find(
      (location) => location.employeeDocId === selectedEmployeeDocId,
    ) ?? null;
  const visibleAlertCount = filteredLocations.filter(
    (location) => getGuardLocationHealth(location, now) !== "live",
  ).length;
  const hasActiveFilters =
    Boolean(searchTerm) ||
    healthFilter !== "all" ||
    districtFilter !== "all" ||
    clientFilter !== "all" ||
    siteFilter !== "all";
  const scopeKey = [
    healthFilter,
    districtFilter,
    clientFilter,
    siteFilter,
    searchTerm.trim().toLowerCase(),
  ].join("|");

  const requestViewport = (type: MapViewportRequest["type"]) =>
    setViewportRequest({ type, nonce: Date.now() });

  const clearFilters = () => {
    setSearchTerm("");
    setHealthFilter("all");
    setDistrictFilter("all");
    setClientFilter("all");
    setSiteFilter("all");
    setSelectedEmployeeDocId(null);
  };

  const healthExplanation = (health: GuardLocationHealth) => {
    switch (health) {
      case "out_of_zone":
        return "The latest location is outside the assigned site boundary.";
      case "poor_accuracy":
        return "The device GPS signal is not accurate enough for a reliable zone check.";
      case "delayed":
        return "No fresh location has arrived in the last five minutes.";
      case "stale":
        return "Tracking has not updated for more than ten minutes.";
      default:
        return "The guard is reporting recently from within the assigned site zone.";
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        {/* KPI bar */}
        <div className="flex items-center justify-between mb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Live Guard Locations
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              aria-label="Show live locations on map"
              variant={viewMode === "map" ? "default" : "ghost"}
              size="sm"
              className="h-11 w-11 p-0 sm:h-9 sm:w-9"
              onClick={() => setViewMode("map")}
            >
              <MapIcon className="h-4 w-4" />
            </Button>
            <Button
              aria-label="Show live locations as a list"
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              className="h-11 w-11 p-0 sm:h-9 sm:w-9"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {!loading && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={healthFilter === "live"}
              onClick={() => setHealthFilter(healthFilter === "live" ? "all" : "live")}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                healthFilter === "live"
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-emerald-200 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-100"
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {inZone} in zone
            </button>
            <button
              type="button"
              aria-pressed={healthFilter === "all"}
              onClick={() => setHealthFilter("all")}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                healthFilter === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <MapPin className="h-3 w-3" />
              {onDuty} on duty
            </button>
            {outOfZone > 0 && (
              <button
                type="button"
                aria-pressed={healthFilter === "out_of_zone"}
                onClick={() =>
                  setHealthFilter(
                    healthFilter === "out_of_zone" ? "all" : "out_of_zone",
                  )
                }
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                  healthFilter === "out_of_zone"
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-red-200 bg-red-50/50 text-red-700 hover:bg-red-100"
                }`}
              >
                <AlertTriangle className="h-3 w-3" />
                {outOfZone} out of zone
              </button>
            )}
            {stale > 0 && (
              <button
                type="button"
                aria-pressed={healthFilter === "stale"}
                onClick={() => setHealthFilter(healthFilter === "stale" ? "all" : "stale")}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                  healthFilter === "stale"
                    ? "border-amber-600 bg-amber-600 text-white"
                    : "border-amber-200 bg-amber-50/50 text-amber-700 hover:bg-amber-100"
                }`}
              >
                <WifiOff className="h-3 w-3" />
                {stale} stale
              </button>
            )}
            {delayed > 0 && (
              <button
                type="button"
                aria-pressed={healthFilter === "delayed"}
                onClick={() => setHealthFilter(healthFilter === "delayed" ? "all" : "delayed")}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                  healthFilter === "delayed"
                    ? "border-amber-600 bg-amber-600 text-white"
                    : "border-amber-200 bg-amber-50/50 text-amber-700 hover:bg-amber-100"
                }`}
              >
                <Clock className="h-3 w-3" />
                {delayed} delayed
              </button>
            )}
            {poorAccuracy > 0 && (
              <button
                type="button"
                aria-pressed={healthFilter === "poor_accuracy"}
                onClick={() =>
                  setHealthFilter(
                    healthFilter === "poor_accuracy" ? "all" : "poor_accuracy",
                  )
                }
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                  healthFilter === "poor_accuracy"
                    ? "border-violet-600 bg-violet-600 text-white"
                    : "border-violet-200 bg-violet-50/50 text-violet-700 hover:bg-violet-100"
                }`}
              >
                <AlertTriangle className="h-3 w-3" />
                {poorAccuracy} weak GPS
              </button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="px-6 pb-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 rounded-lg bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : locationsError ? (
          <div className="px-6 py-10 text-center text-sm text-red-700">
            <AlertTriangle className="mx-auto mb-2 h-8 w-8 opacity-60" />
            <p>{locationsError}</p>
          </div>
        ) : markedInLocations.length === 0 ? (
          <div className="px-6 pb-6 text-center text-sm text-muted-foreground py-8">
            <MapPin className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No guards currently on duty with live tracking.</p>
            <p className="text-xs mt-1">
              Locations appear when guards clock in via the mobile app.
            </p>
          </div>
        ) : viewMode === "map" ? (
          <div className="space-y-3 p-3">
            <div className="rounded-xl border bg-muted/20 p-2.5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Funnel className="h-4 w-4" />
                  Operational filters
                  <span className="font-normal">
                    {filteredLocations.length} of {markedInLocations.length} guards
                  </span>
                </div>
                {hasActiveFilters ? (
                  <Button variant="ghost" size="sm" className="h-8" onClick={clearFilters}>
                    <X className="mr-1 h-3.5 w-3.5" />
                    Clear
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="relative sm:col-span-2 lg:col-span-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search live guards"
                    placeholder="Guard, ID, site or district"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="h-10 pl-9 text-sm"
                  />
                </div>
                <Select value={districtFilter} onValueChange={setDistrictFilter}>
                  <SelectTrigger aria-label="Filter by district" className="h-10">
                    <SelectValue placeholder="All districts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All districts</SelectItem>
                    {filterOptions.districts.map((district) => (
                      <SelectItem key={district} value={district}>{district}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={clientFilter} onValueChange={setClientFilter}>
                  <SelectTrigger aria-label="Filter by client" className="h-10">
                    <SelectValue placeholder="All clients" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All clients</SelectItem>
                    {filterOptions.clients.map((client) => (
                      <SelectItem key={client} value={client}>{client}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={siteFilter} onValueChange={setSiteFilter}>
                  <SelectTrigger aria-label="Filter by site" className="h-10">
                    <SelectValue placeholder="All sites" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sites</SelectItem>
                    {filterOptions.sites.map(([siteId, siteName]) => (
                      <SelectItem key={siteId} value={siteId}>{siteName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {filteredLocations.length === 0 ? (
              <div className="rounded-xl border border-dashed px-6 py-14 text-center">
                <Funnel className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">No guards match these filters.</p>
                <Button variant="link" size="sm" onClick={clearFilters}>Clear filters</Button>
              </div>
            ) : (
            <div
              className={`flex flex-col gap-3 md:flex-row ${
                isFullscreen
                  ? "fixed inset-2 z-[100] overflow-auto rounded-2xl border bg-background p-3 shadow-2xl md:inset-4"
                  : ""
              }`}
            >
              <div className="relative h-[400px] overflow-hidden rounded-xl border md:h-[540px] md:flex-1">
                <div className="absolute left-3 top-3 z-[500] flex flex-wrap gap-1.5">
                  <Button
                    aria-label="Fit all visible guards"
                    title="Fit all visible guards"
                    variant="secondary"
                    size="sm"
                    className="h-9 bg-background/95 shadow"
                    onClick={() => requestViewport("fit_all")}
                  >
                    <Crosshair className="mr-1.5 h-4 w-4" />
                    Fit all
                  </Button>
                  {visibleAlertCount > 0 && (
                    <Button
                      aria-label="Zoom to guards needing attention"
                      title="Zoom to guards needing attention"
                      variant="secondary"
                      size="sm"
                      className="h-9 bg-background/95 text-red-700 shadow"
                      onClick={() => requestViewport("fit_alerts")}
                    >
                      <AlertTriangle className="mr-1.5 h-4 w-4" />
                      Alerts
                    </Button>
                  )}
                  <Button
                    aria-label="Reset map to Kerala overview"
                    title="Reset map"
                    variant="secondary"
                    size="icon"
                    className="h-9 w-9 bg-background/95 shadow"
                    onClick={() => requestViewport("reset")}
                  >
                    <MapIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-label={isFullscreen ? "Exit full screen map" : "Open full screen map"}
                    title={isFullscreen ? "Exit full screen" : "Full screen"}
                    variant="secondary"
                    size="icon"
                    className="h-9 w-9 bg-background/95 shadow"
                    onClick={() => setIsFullscreen((value) => !value)}
                  >
                    {isFullscreen ? <X className="h-4 w-4" /> : <ArrowsOut className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="absolute bottom-6 left-3 z-[500] rounded-lg border bg-background/95 px-2.5 py-2 text-[10px] shadow">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-foreground">Guard status</span>
                    <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" />In zone</span>
                    <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-red-600" />Out of zone</span>
                    <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-violet-600" />Weak GPS</span>
                    <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-600" />Delayed</span>
                    <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-gray-500" />Stale</span>
                    <span className="flex items-center gap-1"><i className="h-2 w-2 rotate-45 rounded-[2px] bg-[#b58b32]" />Site</span>
                  </div>
                </div>
                <LiveGuardMap
                  locations={filteredLocations}
                  selectedEmployeeDocId={selectedGuard?.employeeDocId}
                  now={now}
                  scopeKey={scopeKey}
                  viewportRequest={viewportRequest}
                  resizeSignal={isFullscreen ? 1 : 0}
                  onSelectGuard={(location) =>
                    setSelectedEmployeeDocId(location.employeeDocId)
                  }
                />
              </div>
              <div className="shrink-0 space-y-2 md:w-80">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  aria-label="Search guards in sidebar"
                  placeholder="Search visible guards..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-10 pl-9 text-sm"
                />
              </div>
              <div className="max-h-[300px] space-y-1 overflow-y-auto md:max-h-[330px]">
                {filteredLocations.map((loc) => {
                  const updated = guardLocationUpdatedAt(loc);
                  const health = healthFor(loc);
                  const isSelected = selectedGuard?.employeeDocId === loc.employeeDocId;
                  return (
                    <button
                      key={loc.employeeDocId}
                      onClick={() => setSelectedEmployeeDocId(loc.employeeDocId)}
                      className={`min-h-11 w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "bg-primary/5 border-primary/30"
                          : "bg-card border-border/60 hover:bg-muted/50"
                      }`}
                    >
                      <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        health === "out_of_zone"
                          ? "bg-red-500"
                          : health === "poor_accuracy"
                            ? "bg-violet-500"
                            : health === "live"
                              ? "bg-emerald-500"
                              : "bg-amber-500"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{loc.guardName}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{loc.siteName}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {updated ? timeAgo(updated) : "No time"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {selectedGuard && (
                <div className="rounded-xl border bg-muted/30 p-3 text-xs" aria-live="polite">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{selectedGuard.guardName}</p>
                      <p className="text-muted-foreground">
                        {selectedGuard.siteName}
                        {selectedGuard.district ? ` · ${selectedGuard.district}` : ""}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {guardLocationHealthLabel(healthFor(selectedGuard))}
                    </Badge>
                  </div>
                  <p className="mt-2 rounded-lg bg-background/80 px-2.5 py-2 leading-relaxed text-muted-foreground">
                    {healthExplanation(healthFor(selectedGuard))}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-muted-foreground">
                    <span>ID {selectedGuard.employeeId || "unavailable"}</span>
                    <span>Accuracy ±{Math.round(selectedGuard.accuracy)} m</span>
                    <span>
                      {typeof selectedGuard.distanceFromSite === "number"
                        ? `${Math.round(selectedGuard.distanceFromSite)} m from site`
                        : "Site distance unavailable"}
                    </span>
                    <span>
                      {guardLocationUpdatedAt(selectedGuard)
                        ? `Updated ${timeAgo(guardLocationUpdatedAt(selectedGuard) as Date)}`
                        : "Update time unavailable"}
                    </span>
                    <span>{selectedGuard.clientName || "Client unavailable"}</span>
                    {typeof selectedGuard.batteryLevel === "number" ? (
                      <span className="flex items-center gap-1">
                        <BatteryHigh className="h-3.5 w-3.5" />
                        Battery {Math.round(selectedGuard.batteryLevel)}%
                      </span>
                    ) : null}
                    {typeof selectedGuard.speed === "number" ? (
                      <span className="flex items-center gap-1">
                        <Speedometer className="h-3.5 w-3.5" />
                        {selectedGuard.speed < 1
                          ? "Stationary"
                          : `${selectedGuard.speed.toFixed(1)} m/s`}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <a
                      href={`/employees/${selectedGuard.employeeDocId}`}
                      className="inline-flex min-h-9 items-center justify-center rounded-md border bg-background px-2 font-medium hover:bg-muted"
                    >
                      Guard profile
                    </a>
                    <a
                      href={`https://www.google.com/maps?q=${selectedGuard.lat},${selectedGuard.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-9 items-center justify-center rounded-md border bg-background px-2 font-medium hover:bg-muted"
                    >
                      Open map
                      <ArrowSquareOut className="ml-1 h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              )}
            </div>
            </div>
            )}
          </div>
        ) : (
          /* List view */
          <div className="divide-y divide-border/50">
            {filteredLocations.map((loc) => {
              const updated = guardLocationUpdatedAt(loc);
              const health = healthFor(loc);
              return (
                <div
                  key={loc.employeeDocId}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="relative shrink-0">
                    <div
                      className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold ${
                        health === "out_of_zone"
                          ? "bg-red-100 text-red-700"
                          : health === "poor_accuracy"
                          ? "bg-violet-100 text-violet-700"
                          : health !== "live"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {loc.guardName?.charAt(0)?.toUpperCase() || "G"}
                    </div>
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${
                        health === "out_of_zone"
                          ? "bg-red-500"
                          : health === "poor_accuracy"
                            ? "bg-violet-500"
                            : health === "live"
                              ? "bg-emerald-500"
                              : "bg-amber-500"
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{loc.guardName}</p>
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {loc.siteName}
                      {loc.district ? ` · ${loc.district}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium">
                      {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                    </p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                      <Clock className="h-3 w-3" />
                      {health !== "live" ? `${guardLocationHealthLabel(health)} · ` : ""}
                      {updated ? timeAgo(updated) : "No update time"}
                    </p>
                  </div>
                  {health === "out_of_zone" && (
                    <Badge variant="destructive" className="text-[10px] h-5 px-1.5 shrink-0">
                      OUT
                    </Badge>
                  )}
                  {health === "stale" && (
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5 shrink-0 border-amber-300 text-amber-700">
                      STALE
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
