"use client";

import React, { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, WifiOff, AlertTriangle, Clock, Search, List, Map as MapIcon } from "lucide-react";
import type { GuardLocation } from "@/types/guard-location";
import { LiveGuardMap } from "@/components/dashboard/live-guard-map";

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
  district,
  clientName,
}: {
  district?: string;
  clientName?: string;
}) {
  const [locations, setLocations] = useState<GuardLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGuard, setSelectedGuard] = useState<GuardLocation | null>(null);

  useEffect(() => {
    let q = query(
      collection(db, "guardLocations"),
      where("status", "==", "In")
    );
    if (district && district.trim()) {
      q = query(q, where("district", "==", district.trim()));
    }
    if (clientName && clientName.trim()) {
      q = query(q, where("clientName", "==", clientName.trim()));
    }

    const unsub = onSnapshot(
      q,
      (snap) => {
        const locs: GuardLocation[] = [];
        snap.forEach((doc) => {
          locs.push(doc.data() as GuardLocation);
        });
        locs.sort((a, b) => {
          const aTime = a.updatedAt?.toDate?.()?.getTime() ?? 0;
          const bTime = b.updatedAt?.toDate?.()?.getTime() ?? 0;
          return bTime - aTime;
        });
        setLocations(locs);
        setLoading(false);
      },
      (err) => {
        console.error("LiveGuardsSection error:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [district, clientName]);

  const onDuty = locations.filter((l) => l.status === "In").length;
  const outOfZone = locations.filter((l) => l.isOutOfZone).length;
  const stale = locations.filter((l) => {
    const updated = l.updatedAt?.toDate?.();
    return updated && Date.now() - updated.getTime() > 10 * 60 * 1000;
  }).length;
  const inZone = onDuty - outOfZone - stale;

  const filteredLocations = searchTerm
    ? locations.filter(
        (l) =>
          l.guardName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          l.siteName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          l.district?.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : locations;

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
              variant={viewMode === "map" ? "default" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setViewMode("map")}
            >
              <MapIcon className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {!loading && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs gap-1.5 border-emerald-200 text-emerald-700 bg-emerald-50/50">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {inZone} in zone
            </Badge>
            <Badge variant="outline" className="text-xs gap-1.5 border-emerald-200 text-emerald-700">
              <MapPin className="h-3 w-3" />
              {onDuty} on duty
            </Badge>
            {outOfZone > 0 && (
              <Badge variant="outline" className="text-xs gap-1.5 border-red-200 text-red-700 bg-red-50/50">
                <AlertTriangle className="h-3 w-3" />
                {outOfZone} out of zone
              </Badge>
            )}
            {stale > 0 && (
              <Badge variant="outline" className="text-xs gap-1.5 border-amber-200 text-amber-700 bg-amber-50/50">
                <WifiOff className="h-3 w-3" />
                {stale} stale
              </Badge>
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
        ) : locations.length === 0 ? (
          <div className="px-6 pb-6 text-center text-sm text-muted-foreground py-8">
            <MapPin className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No guards currently on duty with live tracking.</p>
            <p className="text-xs mt-1">
              Locations appear when guards clock in via the mobile app.
            </p>
          </div>
        ) : viewMode === "map" ? (
          <div className="flex flex-col md:flex-row gap-3 p-3">
            {/* Map */}
            <div className="h-[400px] md:h-[500px] md:flex-1 rounded-xl overflow-hidden border">
              <LiveGuardMap
                locations={filteredLocations}
                onSelectGuard={(loc) => setSelectedGuard(loc)}
              />
            </div>
            {/* Sidebar / Guard list */}
            <div className="md:w-72 shrink-0 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search guards..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
              <div className="space-y-1 max-h-[440px] overflow-y-auto">
                {filteredLocations.map((loc) => {
                  const updated = loc.updatedAt?.toDate?.() ?? new Date();
                  const isStale = Date.now() - updated.getTime() > 10 * 60 * 1000;
                  const isSelected = selectedGuard?.employeeDocId === loc.employeeDocId;
                  return (
                    <button
                      key={loc.employeeDocId}
                      onClick={() => setSelectedGuard(loc)}
                      className={`w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "bg-primary/5 border-primary/30"
                          : "bg-card border-border/60 hover:bg-muted/50"
                      }`}
                    >
                      <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        loc.isOutOfZone ? "bg-red-500" : isStale ? "bg-amber-500" : "bg-emerald-500"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{loc.guardName}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{loc.siteName}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(updated)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* List view */
          <div className="divide-y divide-border/50">
            {filteredLocations.map((loc) => {
              const updated = loc.updatedAt?.toDate?.() ?? new Date();
              const isStale = Date.now() - updated.getTime() > 10 * 60 * 1000;
              return (
                <div
                  key={loc.employeeDocId}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="relative shrink-0">
                    <div
                      className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold ${
                        loc.isOutOfZone
                          ? "bg-red-100 text-red-700"
                          : isStale
                          ? "bg-amber-100 text-amber-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {loc.guardName?.charAt(0)?.toUpperCase() || "G"}
                    </div>
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${
                        loc.isOutOfZone ? "bg-red-500" : isStale ? "bg-amber-500" : "bg-emerald-500"
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
                      {isStale ? "Stale \u00b7 " : ""}
                      {timeAgo(updated)}
                    </p>
                  </div>
                  {loc.isOutOfZone && (
                    <Badge variant="destructive" className="text-[10px] h-5 px-1.5 shrink-0">
                      OUT
                    </Badge>
                  )}
                  {isStale && !loc.isOutOfZone && (
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
