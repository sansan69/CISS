"use client";

import React, { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, WifiOff, AlertTriangle, Clock } from "lucide-react";
import type { GuardLocation } from "@/types/guard-location";

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

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Live Guard Locations
          </CardTitle>
          <div className="flex items-center gap-2">
            {!loading && (
              <>
                <Badge
                  variant="outline"
                  className="text-xs gap-1 border-emerald-200 text-emerald-700"
                >
                  <MapPin className="h-3 w-3" />
                  {onDuty} on duty
                </Badge>
                {outOfZone > 0 && (
                  <Badge
                    variant="outline"
                    className="text-xs gap-1 border-red-200 text-red-700"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {outOfZone} out of zone
                  </Badge>
                )}
                {stale > 0 && (
                  <Badge
                    variant="outline"
                    className="text-xs gap-1 border-amber-200 text-amber-700"
                  >
                    <WifiOff className="h-3 w-3" />
                    {stale} stale
                  </Badge>
                )}
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="px-6 pb-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-12 rounded-lg bg-muted/50 animate-pulse"
              />
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
        ) : (
          <div className="divide-y divide-border/50">
            {locations.map((loc) => {
              const updated = loc.updatedAt?.toDate?.() ?? new Date();
              const isStale =
                Date.now() - updated.getTime() > 10 * 60 * 1000;

              return (
                <div
                  key={loc.employeeId}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors"
                >
                  {/* Avatar */}
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
                        loc.isOutOfZone
                          ? "bg-red-500"
                          : isStale
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {loc.guardName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {loc.siteName}
                      {loc.district ? ` · ${loc.district}` : ""}
                    </p>
                  </div>

                  {/* Meta */}
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium">
                      {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                    </p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                      <Clock className="h-3 w-3" />
                      {isStale ? "Stale · " : ""}
                      {timeAgo(updated)}
                    </p>
                  </div>

                  {/* Status badge */}
                  {loc.isOutOfZone && (
                    <Badge
                      variant="destructive"
                      className="text-[10px] h-5 px-1.5 shrink-0"
                    >
                      OUT
                    </Badge>
                  )}
                  {isStale && !loc.isOutOfZone && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-5 px-1.5 shrink-0 border-amber-300 text-amber-700"
                    >
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
