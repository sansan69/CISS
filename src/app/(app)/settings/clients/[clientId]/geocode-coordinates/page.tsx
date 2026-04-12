"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import type { BatchGeocodeResult } from "@/app/api/admin/sites/batch-geocode/route";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  MapPin,
  Loader2,
  ArrowLeft,
  Play,
} from "lucide-react";

// ─── Status helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: BatchGeocodeResult["status"] }) {
  switch (status) {
    case "updated":
      return (
        <Badge variant="outline" className="gap-1 text-green-700 border-green-200 bg-green-50">
          <CheckCircle2 className="h-3 w-3" /> Updated
        </Badge>
      );
    case "kept":
      return (
        <Badge variant="outline" className="gap-1 text-blue-700 border-blue-200 bg-blue-50">
          <SkipForward className="h-3 w-3" /> Kept
        </Badge>
      );
    case "skipped":
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <SkipForward className="h-3 w-3" /> Skipped
        </Badge>
      );
    case "no_result":
      return (
        <Badge variant="outline" className="gap-1 text-amber-700 border-amber-200 bg-amber-50">
          <AlertTriangle className="h-3 w-3" /> No result
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="outline" className="gap-1 text-red-700 border-red-200 bg-red-50">
          <XCircle className="h-3 w-3" /> Failed
        </Badge>
      );
    default:
      return null;
  }
}

function CoordPill({ lat, lng }: { lat?: number; lng?: number }) {
  if (lat == null || lng == null) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span className="font-mono text-xs text-muted-foreground">
      {lat.toFixed(5)}, {lng.toFixed(5)}
    </span>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function GeocodeCoordinatesPage() {
  const params = useParams();
  const clientId = params.clientId as string;
  const router = useRouter();
  const { toast } = useToast();

  const [includeInvalid, setIncludeInvalid] = useState(true);
  const [includeGeocoded, setIncludeGeocoded] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BatchGeocodeResult[] | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setResults(null);
    try {
      const res = await authorizedFetch("/api/admin/sites/batch-geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, includeInvalid, includeGeocoded }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || `Server error ${res.status}`);
      }
      const data = (await res.json()) as { results: BatchGeocodeResult[] };
      setResults(data.results);

      const updated = data.results.filter((r) => r.status === "updated").length;
      const failed = data.results.filter((r) => r.status === "failed" || r.status === "no_result").length;

      if (data.results.length === 0) {
        toast({ title: "All coordinates are already set", description: "No sites needed geocoding." });
      } else {
        toast({
          title: `Geocoding complete — ${updated} updated`,
          description: failed > 0 ? `${failed} site${failed !== 1 ? "s" : ""} could not be geocoded.` : "All processed successfully.",
          variant: failed > 0 ? "destructive" : "default",
        });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Geocoding failed", description: err.message });
    } finally {
      setRunning(false);
    }
  };

  // ── Summary counts ──
  const counts = results
    ? {
        updated: results.filter((r) => r.status === "updated").length,
        kept: results.filter((r) => r.status === "kept").length,
        noResult: results.filter((r) => r.status === "no_result").length,
        failed: results.filter((r) => r.status === "failed").length,
        skipped: results.filter((r) => r.status === "skipped").length,
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Clients & Sites"
        title="Geocode Missing Coordinates"
        description="Automatically look up and assign latitude / longitude for sites that are missing valid GPS coordinates."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Settings", href: "/settings" },
          { label: "Clients & Sites", href: "/settings/clients" },
          { label: clientId, href: `/settings/clients/${clientId}` },
          { label: "Geocode Coordinates" },
        ]}
        actions={
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
        }
      />

      {/* ── Controls ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Options</CardTitle>
          <CardDescription>
            The geocoder uses site address, district, and state to look up coordinates via OpenCage.
            Sites marked as <em>verified</em> or <em>manually overridden</em> are always skipped.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="include-invalid" className="font-medium">
                Fix invalid coordinates
              </Label>
              <p className="text-sm text-muted-foreground mt-0.5">
                Re-geocode sites whose existing coordinates fall outside India's bounding box
                (e.g. wrong country).
              </p>
            </div>
            <Switch
              id="include-invalid"
              checked={includeInvalid}
              onCheckedChange={setIncludeInvalid}
              disabled={running}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="include-geocoded" className="font-medium">
                Re-geocode previously geocoded sites
              </Label>
              <p className="text-sm text-muted-foreground mt-0.5">
                Also update sites that were already auto-geocoded but may have imprecise results.
              </p>
            </div>
            <Switch
              id="include-geocoded"
              checked={includeGeocoded}
              onCheckedChange={setIncludeGeocoded}
              disabled={running}
            />
          </div>

          <Separator />

          <Button onClick={handleRun} disabled={running} className="w-full sm:w-auto">
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running geocoding…
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" /> Run Geocoding
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ── Results ── */}
      {results !== null && (
        <>
          {results.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle2 className="h-8 w-8 mx-auto text-green-500 mb-3" />
                <p className="font-medium">All coordinates are already set</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No sites needed geocoding with the current options.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-3">
                  <CardTitle className="text-base">Results</CardTitle>
                  {counts && (
                    <div className="flex flex-wrap gap-2">
                      {counts.updated > 0 && (
                        <Badge variant="outline" className="text-green-700 border-green-200 bg-green-50">
                          {counts.updated} updated
                        </Badge>
                      )}
                      {counts.kept > 0 && (
                        <Badge variant="outline" className="text-blue-700 border-blue-200 bg-blue-50">
                          {counts.kept} kept
                        </Badge>
                      )}
                      {counts.noResult > 0 && (
                        <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50">
                          {counts.noResult} no result
                        </Badge>
                      )}
                      {counts.failed > 0 && (
                        <Badge variant="outline" className="text-red-700 border-red-200 bg-red-50">
                          {counts.failed} failed
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {results.map((r) => (
                    <div key={r.siteId} className="px-6 py-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="font-medium text-sm truncate">{r.siteName}</span>
                          <StatusBadge status={r.status} />
                        </div>
                        {r.siteAddress && (
                          <p className="text-xs text-muted-foreground mt-1 ml-5 truncate">{r.siteAddress}</p>
                        )}
                        {r.message && r.status !== "updated" && r.status !== "kept" && (
                          <p className="text-xs text-muted-foreground mt-1 ml-5">{r.message}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5 text-right ml-5 sm:ml-0 flex-shrink-0">
                        {r.status === "updated" ? (
                          <>
                            <CoordPill lat={r.newLat} lng={r.newLng} />
                            {r.oldLat != null && (
                              <span className="text-xs text-muted-foreground/50 line-through">
                                <CoordPill lat={r.oldLat} lng={r.oldLng} />
                              </span>
                            )}
                          </>
                        ) : (
                          <CoordPill lat={r.oldLat} lng={r.oldLng} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
