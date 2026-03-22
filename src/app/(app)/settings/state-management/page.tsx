"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useAppAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { APP_MODE, REGION_CODE, REGION_NAME } from "@/lib/runtime-config";
import type { RegionRecord } from "@/types/region";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Globe,
  KeyRound,
  Loader2,
  Plus,
  Rocket,
  Save,
  ShieldCheck,
} from "lucide-react";

type RegionFormState = {
  regionCode: string;
  regionName: string;
  firebaseProjectId: string;
  firebaseApiKey: string;
  firebaseWebAppId: string;
  storageBucket: string;
  authDomain: string;
  messagingSenderId: string;
  measurementId: string;
  regionAdminEmail: string;
};

const emptyCreateForm: RegionFormState = {
  regionCode: "",
  regionName: "",
  firebaseProjectId: "",
  firebaseApiKey: "",
  firebaseWebAppId: "",
  storageBucket: "",
  authDomain: "",
  messagingSenderId: "",
  measurementId: "",
  regionAdminEmail: "",
};

const emptyAdminForm = {
  adminEmail: "",
  adminPassword: "",
  adminDisplayName: "",
};

function checklistItems(region?: RegionRecord | null) {
  const checklist = region?.onboardingChecklist;
  return [
    { label: "Metadata saved", done: checklist?.metadataSaved ?? false },
    { label: "Firebase validated", done: checklist?.firebaseValidated ?? false },
    { label: "Defaults seeded", done: checklist?.defaultsSeeded ?? false },
    { label: "Region admin created", done: checklist?.regionAdminCreated ?? false },
    { label: "Vercel configured", done: checklist?.vercelConfigured ?? false },
  ];
}

function regionToForm(region: RegionRecord | null): RegionFormState {
  if (!region) return emptyCreateForm;
  return {
    regionCode: region.regionCode ?? "",
    regionName: region.regionName ?? "",
    firebaseProjectId: region.firebaseProjectId ?? "",
    firebaseApiKey: region.firebaseApiKey ?? "",
    firebaseWebAppId: region.firebaseWebAppId ?? "",
    storageBucket: region.storageBucket ?? "",
    authDomain: region.authDomain ?? "",
    messagingSenderId: region.messagingSenderId ?? "",
    measurementId: region.measurementId ?? "",
    regionAdminEmail: region.regionAdminEmail ?? "",
  };
}

export default function RegionOnboardingPage() {
  const { isSuperAdmin } = useAppAuth();
  const { toast } = useToast();

  const [regions, setRegions] = useState<RegionRecord[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string>("");
  const [selectedRegion, setSelectedRegion] = useState<RegionRecord | null>(null);
  const [form, setForm] = useState<RegionFormState>(emptyCreateForm);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState<RegionFormState>(emptyCreateForm);
  const [serviceAccountPayload, setServiceAccountPayload] = useState("");
  const [adminForm, setAdminForm] = useState(emptyAdminForm);
  const [validationMessages, setValidationMessages] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isCreatingAdmin, setIsCreatingAdmin] = useState(false);

  const loadRegions = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await authorizedFetch("/api/super-admin/regions");
      const data = await res.json();
      const list = (data.regions ?? []) as RegionRecord[];
      setRegions(list);
      setSelectedRegionId((current) => current || list[0]?.id || "");
    } catch {
      toast({
        title: "Could not load regions",
        description: "The onboarding control plane is not reachable right now.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isSuperAdmin) {
      void loadRegions();
    }
  }, [isSuperAdmin, loadRegions]);

  useEffect(() => {
    const nextRegion =
      regions.find((region) => region.id === selectedRegionId || region.regionCode === selectedRegionId) ||
      null;
    setSelectedRegion(nextRegion);
    setForm(regionToForm(nextRegion));
    setAdminForm((current) => ({
      ...current,
      adminEmail: nextRegion?.regionAdminEmail ?? current.adminEmail,
    }));
    setValidationMessages([]);
  }, [regions, selectedRegionId]);

  const selectedChecklist = useMemo(() => checklistItems(selectedRegion), [selectedRegion]);

  const refreshSelectedRegion = useCallback(async () => {
    if (!selectedRegionId) return;
    const res = await authorizedFetch(`/api/super-admin/regions/${selectedRegionId}`);
    const data = await res.json();
    const nextRegion = data.region as RegionRecord;
    setRegions((current) => {
      const filtered = current.filter((region) => region.id !== selectedRegionId);
      return [nextRegion, ...filtered].sort((a, b) => a.regionCode.localeCompare(b.regionCode));
    });
  }, [selectedRegionId]);

  const handleCreateRegion = async () => {
    if (!createForm.regionCode || !createForm.regionName || !createForm.firebaseProjectId) {
      toast({
        title: "Missing details",
        description: "Region code, region name, and Firebase project ID are required.",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    try {
      const res = await authorizedFetch("/api/super-admin/regions", {
        method: "POST",
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not create region.");
      }

      toast({
        title: "Region created",
        description: `${createForm.regionName} is ready for Firebase validation.`,
      });
      setCreateDialogOpen(false);
      setCreateForm(emptyCreateForm);
      await loadRegions();
      setSelectedRegionId(data.id);
    } catch (error: any) {
      toast({
        title: "Create failed",
        description: error?.message || "Could not create the region record.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveMetadata = async () => {
    if (!selectedRegion || selectedRegion.isSynthetic) {
      toast({
        title: "Kerala runtime is read-only here",
        description: "The current Kerala region is shown for reference. Create new region records for onboarding other regions.",
      });
      return;
    }

    setIsSaving(true);
    try {
      const res = await authorizedFetch(`/api/super-admin/regions/${selectedRegion.id}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed.");

      toast({
        title: "Metadata saved",
        description: "Region connection details have been updated.",
      });
      await refreshSelectedRegion();
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error?.message || "Could not update the region metadata.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const buildSecretPayload = () => {
    const trimmed = serviceAccountPayload.trim();
    if (!trimmed) {
      throw new Error("Paste the region service account JSON or Base64 payload first.");
    }

    const looksLikeJson = trimmed.startsWith("{");
    return looksLikeJson
      ? { serviceAccountJson: trimmed }
      : { serviceAccountBase64: trimmed };
  };

  const handleValidateRegion = async () => {
    if (!selectedRegion || selectedRegion.isSynthetic) return;
    setIsValidating(true);
    try {
      const res = await authorizedFetch(`/api/super-admin/regions/${selectedRegion.id}/validate`, {
        method: "POST",
        body: JSON.stringify(buildSecretPayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Validation failed.");

      setValidationMessages(data.messages ?? []);
      toast({
        title: data.success ? "Firebase validated" : "Validation completed with issues",
        description: data.success
          ? "Firestore, Auth, and Storage are reachable for this region."
          : "Check the validation results before seeding this region.",
        variant: data.success ? "default" : "destructive",
      });
      await refreshSelectedRegion();
    } catch (error: any) {
      toast({
        title: "Validation failed",
        description: error?.message || "Could not validate the region Firebase backend.",
        variant: "destructive",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleSeedRegion = async () => {
    if (!selectedRegion || selectedRegion.isSynthetic) return;
    setIsSeeding(true);
    try {
      const res = await authorizedFetch(`/api/super-admin/regions/${selectedRegion.id}/seed`, {
        method: "POST",
        body: JSON.stringify(buildSecretPayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Seed failed.");

      toast({
        title: "Region prepared",
        description: `Seeded ${data.seededDocs?.length ?? 0} backend defaults for ${selectedRegion.regionName}.`,
      });
      await refreshSelectedRegion();
    } catch (error: any) {
      toast({
        title: "Seeding failed",
        description: error?.message || "Could not seed the region backend.",
        variant: "destructive",
      });
    } finally {
      setIsSeeding(false);
    }
  };

  const handleCreateAdmin = async () => {
    if (!selectedRegion || selectedRegion.isSynthetic) return;
    if (!adminForm.adminEmail || !adminForm.adminPassword) {
      toast({
        title: "Missing admin details",
        description: "Admin email and password are required.",
        variant: "destructive",
      });
      return;
    }

    setIsCreatingAdmin(true);
    try {
      const res = await authorizedFetch(`/api/super-admin/regions/${selectedRegion.id}/create-admin`, {
        method: "POST",
        body: JSON.stringify({
          ...buildSecretPayload(),
          adminEmail: adminForm.adminEmail,
          adminPassword: adminForm.adminPassword,
          adminDisplayName: adminForm.adminDisplayName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create region admin.");

      toast({
        title: data.created ? "Region admin created" : "Region admin claims updated",
        description: `${adminForm.adminEmail} can now sign into the regional app.`,
      });
      await refreshSelectedRegion();
    } catch (error: any) {
      toast({
        title: "Admin setup failed",
        description: error?.message || "Could not create the region admin account.",
        variant: "destructive",
      });
    } finally {
      setIsCreatingAdmin(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Region Onboarding" backHref="/settings" />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Super admin access is required to onboard new regions.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Region Onboarding"
        description="Keep Kerala on the current backend, then connect and prepare separate Firebase backends for other regions."
        actions={
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Region
          </Button>
        }
      />

      <Card className="border-brand-blue/20 bg-brand-blue-pale/30">
        <CardContent className="flex flex-col gap-2 py-5 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-foreground">
              Current runtime: {APP_MODE === "control-plane" ? "HQ Control Plane" : "Regional Runtime"}
            </p>
            <p className="text-muted-foreground">
              This deployment currently identifies itself as <span className="font-medium text-foreground">{REGION_NAME} ({REGION_CODE})</span>.
            </p>
          </div>
          <Badge variant="secondary" className="w-fit">
            Kerala stays on the existing `ciss-workforce` backend
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regions</CardTitle>
            <CardDescription>HQ-managed region records and onboarding progress</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <>
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </>
            ) : regions.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No region records yet.
              </div>
            ) : (
              regions.map((region) => (
                <button
                  key={region.id}
                  type="button"
                  onClick={() => setSelectedRegionId(region.id)}
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    selectedRegionId === region.id
                      ? "border-brand-blue bg-brand-blue-pale/30"
                      : "border-border hover:border-brand-blue/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-sm">
                        {region.regionName} ({region.regionCode})
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {region.firebaseProjectId || "Project ID pending"}
                      </p>
                    </div>
                    <Badge variant={region.status === "ready" || region.status === "live" ? "default" : "secondary"}>
                      {region.status}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {checklistItems(region).map((item) => (
                      <Badge key={item.label} variant="outline" className="text-[11px]">
                        {item.done ? "✓" : "•"} {item.label}
                      </Badge>
                    ))}
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {!selectedRegion ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Select a region to continue onboarding.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="h-4 w-4 text-brand-blue" />
                  Region Summary
                </CardTitle>
                <CardDescription>
                  Kerala is shown as the current production runtime. Other regions can be connected and prepared here.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 text-sm">
                  <p><span className="font-medium">Region:</span> {selectedRegion.regionName} ({selectedRegion.regionCode})</p>
                  <p><span className="font-medium">Firebase Project:</span> {selectedRegion.firebaseProjectId || "Pending"}</p>
                  <p><span className="font-medium">Web API Key:</span> {selectedRegion.firebaseApiKey ? "Configured" : "Pending"}</p>
                  <p><span className="font-medium">Web App ID:</span> {selectedRegion.firebaseWebAppId || "Pending"}</p>
                  <p><span className="font-medium">Storage Bucket:</span> {selectedRegion.storageBucket || "Pending"}</p>
                  <p><span className="font-medium">Region Admin:</span> {selectedRegion.regionAdminEmail || "Pending"}</p>
                </div>
                <div className="rounded-xl border p-4">
                  <p className="text-sm font-semibold">Readiness Checklist</p>
                  <div className="mt-3 space-y-2">
                    {selectedChecklist.map((item) => (
                      <div key={item.label} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className={`h-4 w-4 ${item.done ? "text-green-600" : "text-muted-foreground"}`} />
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">1. Region Metadata</CardTitle>
                <CardDescription>
                  Save only non-secret metadata here. Service account credentials stay transient in the wizard and are never stored in Kerala Firestore.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Region Code</Label>
                  <Input value={form.regionCode} disabled />
                </div>
                <div className="space-y-1.5">
                  <Label>Region Name</Label>
                  <Input
                    value={form.regionName}
                    onChange={(e) => setForm((current) => ({ ...current, regionName: e.target.value }))}
                    disabled={selectedRegion.isSynthetic}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Firebase Project ID</Label>
                  <Input
                    value={form.firebaseProjectId}
                    onChange={(e) => setForm((current) => ({ ...current, firebaseProjectId: e.target.value }))}
                    disabled={selectedRegion.isSynthetic}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Firebase Web API Key</Label>
                  <Input
                    value={form.firebaseApiKey}
                    onChange={(e) => setForm((current) => ({ ...current, firebaseApiKey: e.target.value }))}
                    disabled={selectedRegion.isSynthetic}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Firebase Web App ID</Label>
                  <Input
                    value={form.firebaseWebAppId}
                    onChange={(e) => setForm((current) => ({ ...current, firebaseWebAppId: e.target.value }))}
                    disabled={selectedRegion.isSynthetic}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Storage Bucket</Label>
                  <Input
                    value={form.storageBucket}
                    onChange={(e) => setForm((current) => ({ ...current, storageBucket: e.target.value }))}
                    disabled={selectedRegion.isSynthetic}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Auth Domain</Label>
                  <Input
                    value={form.authDomain}
                    onChange={(e) => setForm((current) => ({ ...current, authDomain: e.target.value }))}
                    disabled={selectedRegion.isSynthetic}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Messaging Sender ID</Label>
                  <Input
                    value={form.messagingSenderId}
                    onChange={(e) => setForm((current) => ({ ...current, messagingSenderId: e.target.value }))}
                    disabled={selectedRegion.isSynthetic}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Measurement ID</Label>
                  <Input
                    value={form.measurementId}
                    onChange={(e) => setForm((current) => ({ ...current, measurementId: e.target.value }))}
                    disabled={selectedRegion.isSynthetic}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Region Admin Email</Label>
                  <Input
                    type="email"
                    value={form.regionAdminEmail}
                    onChange={(e) => setForm((current) => ({ ...current, regionAdminEmail: e.target.value }))}
                    disabled={selectedRegion.isSynthetic}
                  />
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <Button onClick={handleSaveMetadata} disabled={isSaving || selectedRegion.isSynthetic}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Metadata
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="h-4 w-4 text-brand-gold" />
                  2. Secure Region Credentials
                </CardTitle>
                <CardDescription>
                  Paste the region&apos;s service account JSON or Base64-encoded service account only for this browser session.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={serviceAccountPayload}
                  onChange={(e) => setServiceAccountPayload(e.target.value)}
                  placeholder="Paste service account JSON or Base64 here"
                  rows={8}
                  spellCheck={false}
                  disabled={selectedRegion.isSynthetic}
                />
                <div className="flex flex-wrap gap-3">
                  <Button onClick={handleValidateRegion} disabled={isValidating || selectedRegion.isSynthetic}>
                    {isValidating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                    Validate Firebase
                  </Button>
                  <Button variant="secondary" onClick={handleSeedRegion} disabled={isSeeding || selectedRegion.isSynthetic}>
                    {isSeeding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                    Seed Defaults
                  </Button>
                </div>
                {validationMessages.length > 0 && (
                  <Alert>
                    <AlertTitle>Validation Results</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc pl-5 space-y-1">
                        {validationMessages.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Rocket className="h-4 w-4 text-brand-blue" />
                  3. Create First Regional Admin
                </CardTitle>
                <CardDescription>
                  This user becomes the first admin inside the region&apos;s own Firebase Auth tenant/project.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Admin Email</Label>
                  <Input
                    type="email"
                    value={adminForm.adminEmail}
                    onChange={(e) => setAdminForm((current) => ({ ...current, adminEmail: e.target.value }))}
                    disabled={selectedRegion.isSynthetic}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Display Name</Label>
                  <Input
                    value={adminForm.adminDisplayName}
                    onChange={(e) => setAdminForm((current) => ({ ...current, adminDisplayName: e.target.value }))}
                    placeholder="Regional Admin"
                    disabled={selectedRegion.isSynthetic}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Temporary Password</Label>
                  <Input
                    type="password"
                    value={adminForm.adminPassword}
                    onChange={(e) => setAdminForm((current) => ({ ...current, adminPassword: e.target.value }))}
                    disabled={selectedRegion.isSynthetic}
                  />
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <Button onClick={handleCreateAdmin} disabled={isCreatingAdmin || selectedRegion.isSynthetic}>
                    {isCreatingAdmin ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                    Create Region Admin
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">4. Ready-to-Go Checklist</CardTitle>
                <CardDescription>
                  Once the region is ready, connect a dedicated Vercel deployment to this region&apos;s Firebase config and the region can start with clients, field officers, work orders, guard enrollment, and attendance.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                {!selectedRegion.isSynthetic && (
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          const res = await authorizedFetch(`/api/super-admin/regions/${selectedRegion.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              onboardingChecklist: {
                                ...selectedRegion.onboardingChecklist,
                                vercelConfigured: !(selectedRegion.onboardingChecklist?.vercelConfigured ?? false),
                              },
                            }),
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || "Could not update deployment readiness.");
                          toast({
                            title: data.region?.onboardingChecklist?.vercelConfigured
                              ? "Deployment marked ready"
                              : "Deployment mark removed",
                            description: "Use this once the dedicated regional Vercel runtime has been configured.",
                          });
                          await refreshSelectedRegion();
                        } catch (error: any) {
                          toast({
                            title: "Update failed",
                            description: error?.message || "Could not update deployment readiness.",
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      {selectedRegion.onboardingChecklist?.vercelConfigured ? "Mark deployment not ready" : "Mark deployment configured"}
                    </Button>
                  </div>
                )}
                <p>Recommended next steps after this wizard says the region is ready:</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Set the region&apos;s `NEXT_PUBLIC_FIREBASE_*` and `FIREBASE_ADMIN_*` env vars in its Vercel project.</li>
                  <li>Set `APP_MODE=regional`, `REGION_CODE`, and `REGION_NAME` for that deployment.</li>
                  <li>Deploy the same application codebase to that region&apos;s Vercel project.</li>
                  <li>Use the new region admin account to sign in and create clients, field officers, sites, work orders, and guard records.</li>
                </ol>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Region</DialogTitle>
            <DialogDescription>
              Create a region record first. You can validate the region Firebase backend and seed it afterward.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Region Code *</Label>
              <Input
                value={createForm.regionCode}
                maxLength={8}
                onChange={(e) => setCreateForm((current) => ({ ...current, regionCode: e.target.value.toUpperCase() }))}
                placeholder="TN"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Region Name *</Label>
              <Input
                value={createForm.regionName}
                onChange={(e) => setCreateForm((current) => ({ ...current, regionName: e.target.value }))}
                placeholder="Tamil Nadu"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Firebase Project ID *</Label>
              <Input
                value={createForm.firebaseProjectId}
                onChange={(e) => setCreateForm((current) => ({ ...current, firebaseProjectId: e.target.value }))}
                placeholder="ciss-tamilnadu"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Firebase Web API Key</Label>
              <Input
                value={createForm.firebaseApiKey}
                onChange={(e) => setCreateForm((current) => ({ ...current, firebaseApiKey: e.target.value }))}
                placeholder="AIza..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Firebase Web App ID</Label>
              <Input
                value={createForm.firebaseWebAppId}
                onChange={(e) => setCreateForm((current) => ({ ...current, firebaseWebAppId: e.target.value }))}
                placeholder="1:xxxx:web:xxxx"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Storage Bucket</Label>
              <Input
                value={createForm.storageBucket}
                onChange={(e) => setCreateForm((current) => ({ ...current, storageBucket: e.target.value }))}
                placeholder="project.firebasestorage.app"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Auth Domain</Label>
              <Input
                value={createForm.authDomain}
                onChange={(e) => setCreateForm((current) => ({ ...current, authDomain: e.target.value }))}
                placeholder="project.firebaseapp.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Messaging Sender ID</Label>
              <Input
                value={createForm.messagingSenderId}
                onChange={(e) => setCreateForm((current) => ({ ...current, messagingSenderId: e.target.value }))}
                placeholder="1234567890"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Measurement ID</Label>
              <Input
                value={createForm.measurementId}
                onChange={(e) => setCreateForm((current) => ({ ...current, measurementId: e.target.value }))}
                placeholder="G-XXXXXXX"
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Region Admin Email</Label>
              <Input
                type="email"
                value={createForm.regionAdminEmail}
                onChange={(e) => setCreateForm((current) => ({ ...current, regionAdminEmail: e.target.value }))}
                placeholder="regional-admin@example.com"
              />
            </div>
          </div>
          <div className="mt-2 flex justify-end gap-3">
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateRegion} disabled={isCreating}>
              {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create Region
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
