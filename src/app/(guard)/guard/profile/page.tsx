"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, Phone, User2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useAppAuth } from "@/context/auth-context";

type ProfileData = {
  id: string;
  employeeId?: string;
  fullName?: string;
  phoneNumber?: string;
  emailAddress?: string;
  clientName?: string;
  district?: string;
  resourceIdNumber?: string;
  joiningDate?: string;
  status?: string;
  profilePhotoUrl?: string | null;
  address?: string;
};

function initials(name?: string) {
  return (name || "Guard")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

export default function GuardProfilePage() {
  const { user } = useAppAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileData | null>(null);

  const loadProfile = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/guard/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load profile.");
      setProfile(data.employee ?? null);
    } catch (error: any) {
      toast({
        title: "Could not load profile",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  return (
    <div className="space-y-4 p-4 pb-6">
      <div>
        <p className="text-sm text-gray-500">Personal details</p>
        <h1 className="text-lg font-bold text-gray-900">My Profile</h1>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : profile ? (
        <>
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="flex items-center gap-4 p-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={profile.profilePhotoUrl || undefined} />
                <AvatarFallback>{initials(profile.fullName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-lg font-semibold text-gray-900">{profile.fullName || "Guard"}</p>
                <p className="text-sm text-gray-500">{profile.employeeId || "—"}</p>
                <p className="text-xs text-gray-500">
                  {profile.clientName || "No client"}{profile.district ? ` · ${profile.district}` : ""}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="space-y-4 p-4">
              <div className="flex items-start gap-3">
                <User2 className="mt-0.5 h-4 w-4 text-[#014c85]" />
                <div className="text-sm">
                  <p className="font-medium text-gray-900">Resource ID</p>
                  <p className="text-gray-600">{profile.resourceIdNumber || "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="mt-0.5 h-4 w-4 text-[#014c85]" />
                <div className="text-sm">
                  <p className="font-medium text-gray-900">Contact</p>
                  <p className="text-gray-600">{profile.phoneNumber || "—"}</p>
                  <p className="text-gray-600">{profile.emailAddress || "—"}</p>
                </div>
              </div>
              <div className="text-sm">
                <p className="font-medium text-gray-900">Address</p>
                <p className="text-gray-600">{profile.address || "—"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                  Status: {profile.status || "—"}
                </span>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                  Joined: {profile.joiningDate || "—"}
                </span>
              </div>
            </CardContent>
          </Card>

          <Button asChild className="w-full rounded-xl bg-[#014c85] hover:bg-[#013a6b]">
            <Link href="/guard-login/reset">
              <KeyRound className="mr-1.5 h-4 w-4" />
              Change PIN
            </Link>
          </Button>
        </>
      ) : null}
    </div>
  );
}
