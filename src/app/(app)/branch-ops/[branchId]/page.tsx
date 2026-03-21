"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import type { Branch } from "@/types/branch";

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function BranchDetailPage({
  params,
}: {
  params: Promise<{ branchId: string }>;
}) {
  const { toast } = useToast();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then(({ branchId }) => setBranchId(branchId));
  }, [params]);

  const month = useMemo(() => getCurrentMonth(), []);

  const loadBranch = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await authorizedFetch("/api/admin/branches");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load branch.");
      const matched = (data.branches ?? []).find((item: Branch) => item.id === id) ?? null;
      setBranch(matched);
    } catch (error: any) {
      toast({
        title: "Could not load branch",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (branchId) {
      void loadBranch(branchId);
    }
  }, [branchId, loadBranch]);

  if (loading) {
    return <Skeleton className="h-56 w-full" />;
  }

  if (!branch) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Branch Details" backHref="/branch-ops" />
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Branch not found.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={branch.name}
        backHref="/branch-ops"
        description={`${branch.district} · ${branch.stateCode}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/expenses/${branch.id}/${month}`}>Open Expense Sheet</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="grid gap-4 p-6 md:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">Branch Name</p>
            <p className="text-base font-semibold">{branch.name}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">State / District</p>
            <p className="text-base font-semibold">{branch.stateCode} · {branch.district}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Field Officers Linked</p>
            <p className="text-base font-semibold">{branch.fieldOfficerIds?.length ?? 0}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Contact</p>
            <p className="text-base font-semibold">{branch.phone || branch.email || "—"}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-sm text-muted-foreground">Address</p>
            <p className="text-base font-semibold">{branch.address || "—"}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
