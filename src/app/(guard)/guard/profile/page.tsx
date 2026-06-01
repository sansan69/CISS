"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAppAuth } from "@/context/auth-context";
import {
  User,
  Phone,
  MapPin,
  Building2,
  Calendar,
  IdCard,
  Shield,
  Mail,
} from "lucide-react";


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
    </div>
  );
}
