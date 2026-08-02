"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppAuth } from "@/context/auth-context";
import { getAddressProofTypesForIdentity, IDENTITY_PROOF_TYPES } from "@/lib/constants";
import { AADHAAR_CONSENT_TEXT, AADHAAR_CONSENT_VERSION } from "@/lib/aadhaar-policy";
import {
  User,
  Phone,
  MapPin,
  Buildings as Building2,
  Calendar,
  IdentificationCard as IdCard,
  Shield,
  Envelope as Mail,
} from "@phosphor-icons/react";


interface GuardProfileData {
  fullName: string;
  employeeId: string;
  clientName: string;
  district: string;
  phoneNumber: string;
  status: string;
  gender?: string;
  joiningDate?: string;
  resourceIdNumber?: string;
  profilePhotoUrl?: string | null;
  address?: string;
  emailAddress?: string;
  idProofType?: string | null;
  addressProofType?: string | null;
  missingDocuments: Array<"aadhaar" | "identity" | "address">;
  documentStatus: Record<"aadhaar" | "identity" | "address", "missing" | "complete">;
  enrollmentPolicy: "legacy" | "three-proof-v1";
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function ProfileSkeleton() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div
        className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0 bg-primary/10"
      >
        <Icon size={16} className="text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
        <p className="text-sm font-medium text-foreground break-words">
          {value || "—"}
        </p>
      </div>
    </div>
  );
}

export default function GuardProfilePage() {
  const { user } = useAppAuth();
  const [data, setData] = useState<GuardProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingCategory, setUploadingCategory] = useState<"aadhaar" | "identity" | "address" | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [correctionMessage, setCorrectionMessage] = useState<string | null>(null);
  const [requestingCorrection, setRequestingCorrection] = useState(false);
  const [viewingDocument, setViewingDocument] = useState<"identity" | "address" | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const token = await user.getIdToken();
      const res = await fetch("/api/guard/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json: GuardProfileData = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load profile."
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const submitMissingDocument = async (
    category: "aadhaar" | "identity" | "address",
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!user) return;
    const formElement = event.currentTarget;
    setUploadingCategory(category);
    setUploadMessage(null);
    try {
      const form = new FormData(formElement);
      form.set("category", category);
      if (category === "aadhaar") {
        form.set("consentVersion", AADHAAR_CONSENT_VERSION);
      }
      const token = await user.getIdToken();
      const response = await fetch("/api/guard/profile/documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Document upload failed.");
      formElement.reset();
      setUploadMessage(
        category === "aadhaar"
          ? "Aadhaar submitted successfully. Its details are now visible only to the designated administrator."
          : `${category === "identity" ? "Identity" : "Address"} proof submitted successfully.`,
      );
      await fetchProfile();
    } catch (uploadError) {
      setUploadMessage(uploadError instanceof Error ? uploadError.message : "Document upload failed.");
    } finally {
      setUploadingCategory(null);
    }
  };

  const requestAadhaarCorrection = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    const formElement = event.currentTarget;
    setRequestingCorrection(true);
    setCorrectionMessage(null);
    try {
      const reason = String(new FormData(formElement).get("reason") || "");
      const token = await user.getIdToken();
      const response = await fetch("/api/guard/profile/aadhaar-correction", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Correction request failed.");
      formElement.reset();
      setCorrectionMessage("Your Aadhaar correction request has been sent to the designated administrator.");
    } catch (correctionError) {
      setCorrectionMessage(correctionError instanceof Error ? correctionError.message : "Correction request failed.");
    } finally {
      setRequestingCorrection(false);
    }
  };

  const viewOwnProof = async (category: "identity" | "address") => {
    if (!user) return;
    setViewingDocument(category);
    setUploadMessage(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/guard/profile/documents?category=${category}&side=front`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Document could not be opened.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (viewError) {
      setUploadMessage(viewError instanceof Error ? viewError.message : "Document could not be opened.");
    } finally {
      setViewingDocument(null);
    }
  };

  if (loading) return <ProfileSkeleton />;

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-red-600 text-sm font-medium">Failed to load</p>
          <p className="text-red-500 text-xs mt-1">{error}</p>
          <button
            onClick={fetchProfile}
            className="mt-3 text-xs font-semibold text-red-600 underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-4 space-y-4 pb-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        {data.profilePhotoUrl ? (
          <div className="relative h-16 w-16 rounded-full overflow-hidden ring-2 ring-white shadow-md shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.profilePhotoUrl}
              alt={data.fullName}
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-blue/10 shrink-0">
            <span className="text-2xl font-bold text-brand-blue">
              {(data.fullName || "G").charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-foreground leading-tight">
            {data.fullName}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data.employeeId}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Badge
              variant={data.status === "Active" ? "default" : "secondary"}
              className="text-[11px]"
            >
              {data.status}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {data.clientName}
            </span>
          </div>
        </div>
      </div>

      {/* Details Card */}
      <Card className="rounded-xl shadow-sm border-0">
        <CardContent className="p-2">
          <InfoRow
            icon={Phone}
            label="Phone Number"
            value={data.phoneNumber}
          />
          <Separator />
          <InfoRow
            icon={Mail}
            label="Email"
            value={data.emailAddress || "—"}
          />
          <Separator />
          <InfoRow
            icon={User}
            label="Gender"
            value={data.gender || "—"}
          />
          <Separator />
          <InfoRow
            icon={Calendar}
            label="Joining Date"
            value={data.joiningDate ? formatDate(data.joiningDate) : "—"}
          />
          <Separator />
          <InfoRow
            icon={IdCard}
            label="Resource ID"
            value={data.resourceIdNumber || "—"}
          />
          <Separator />
          <InfoRow
            icon={Building2}
            label="Client"
            value={data.clientName}
          />
          <Separator />
          <InfoRow
            icon={MapPin}
            label="District"
            value={data.district}
          />
          {data.address && (
            <>
              <Separator />
              <InfoRow
                icon={MapPin}
                label="Address"
                value={data.address}
              />
            </>
          )}
        </CardContent>
      </Card>

      {(data.documentStatus.identity === "complete" || data.documentStatus.address === "complete") && (
        <Card className="rounded-xl">
          <CardContent className="space-y-3 p-4">
            <div>
              <h2 className="font-semibold">Your submitted proofs</h2>
              <p className="mt-1 text-xs text-muted-foreground">You may view your identity and address proofs. Aadhaar is never available from the guard profile.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.documentStatus.identity === "complete" && <Button type="button" size="sm" variant="outline" disabled={viewingDocument !== null} onClick={() => void viewOwnProof("identity")}>View identity proof</Button>}
              {data.documentStatus.address === "complete" && <Button type="button" size="sm" variant="outline" disabled={viewingDocument !== null} onClick={() => void viewOwnProof("address")}>View address proof</Button>}
            </div>
            {uploadMessage && <p role="status" className="text-sm">{uploadMessage}</p>}
          </CardContent>
        </Card>
      )}

      {data.enrollmentPolicy === "legacy" && data.missingDocuments.length > 0 && (
        <Card className="rounded-xl">
          <CardContent className="space-y-5 p-4">
            <div>
              <h2 className="font-semibold">Complete missing documents</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Optional for guards enrolled before the three-proof policy. Missing documents do not affect attendance, payroll, or deployment.
              </p>
            </div>

            {data.missingDocuments.includes("aadhaar") && (
              <form className="space-y-3 rounded-lg border p-3" onSubmit={(event) => void submitMissingDocument("aadhaar", event)}>
                <p className="text-sm font-medium">Add Aadhaar for ESIC/EPF</p>
                <Input name="aadhaarNumber" type="password" inputMode="numeric" autoComplete="off" maxLength={12} required placeholder="12-digit Aadhaar number" />
                <label className="block text-xs text-muted-foreground">Upload Aadhaar front side<Input className="mt-1" name="front" type="file" accept="image/jpeg,image/png,application/pdf" required /></label>
                <label className="block text-xs text-muted-foreground">Upload Aadhaar back side<Input className="mt-1" name="back" type="file" accept="image/jpeg,image/png,application/pdf" required /></label>
                <p className="text-xs text-muted-foreground">{AADHAAR_CONSENT_TEXT}</p>
                <label className="flex items-start gap-2 text-xs">
                  <input name="consentAccepted" value="true" type="checkbox" required className="mt-0.5 h-4 w-4" />
                  <span>I consent to this limited Aadhaar use for ESIC and EPF.</span>
                </label>
                <Button type="submit" size="sm" disabled={uploadingCategory !== null}>Submit Aadhaar</Button>
              </form>
            )}

            {(["identity", "address"] as const).filter((category) => data.missingDocuments.includes(category)).map((category) => {
              const options = category === "identity"
                ? IDENTITY_PROOF_TYPES.filter((option) => option !== data.addressProofType)
                : getAddressProofTypesForIdentity(data.idProofType);
              return (
                <form key={category} className="space-y-3 rounded-lg border p-3" onSubmit={(event) => void submitMissingDocument(category, event)}>
                  <p className="text-sm font-medium">Add {category} proof</p>
                  <select name="documentType" required className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                    <option value="">Select document type</option>
                    {options.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <Input name="documentNumber" required maxLength={64} placeholder="Document number" />
                  <label className="block text-xs text-muted-foreground">Front page<Input className="mt-1" name="front" type="file" accept="image/jpeg,image/png,application/pdf" required /></label>
                  <label className="block text-xs text-muted-foreground">Back page, if applicable<Input className="mt-1" name="back" type="file" accept="image/jpeg,image/png,application/pdf" /></label>
                  <Button type="submit" size="sm" disabled={uploadingCategory !== null}>Submit {category} proof</Button>
                </form>
              );
            })}
            {uploadMessage && <p role="status" className="text-sm">{uploadMessage}</p>}
          </CardContent>
        </Card>
      )}

      {data.documentStatus.aadhaar === "complete" && (
        <Card className="rounded-xl">
          <CardContent className="space-y-3 p-4">
            <div>
              <h2 className="font-semibold">Aadhaar correction</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Your Aadhaar is on file but cannot be viewed here. Request a correction if the submitted number or copy is wrong.
              </p>
            </div>
            <form className="space-y-3" onSubmit={(event) => void requestAadhaarCorrection(event)}>
              <textarea name="reason" required minLength={10} maxLength={500} className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Explain what needs to be corrected" />
              <Button type="submit" size="sm" variant="outline" disabled={requestingCorrection}>
                {requestingCorrection ? "Sending…" : "Request correction"}
              </Button>
            </form>
            {correctionMessage && <p role="status" className="text-sm">{correctionMessage}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
