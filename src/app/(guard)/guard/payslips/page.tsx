"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAppAuth } from "@/context/auth-context";

type Payslip = {
  id: string;
  period?: string;
  netPay?: number;
  status?: string;
  payslipUrl?: string;
  createdAt?: { seconds: number };
};

export default function GuardPayslipsPage() {
  const { user } = useAppAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [payslips, setPayslips] = useState<Payslip[]>([]);

  const loadPayslips = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/guard/payslips", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load payslips.");
      setPayslips(data.payslips ?? []);
    } catch (error: any) {
      toast({
        title: "Could not load payslips",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    void loadPayslips();
  }, [loadPayslips]);

  return (
    <div className="space-y-4 p-4 pb-6">
      <div>
        <p className="text-sm text-gray-500">Salary records</p>
        <h1 className="text-lg font-bold text-gray-900">My Payslips</h1>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : payslips.length === 0 ? (
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardContent className="py-14 text-center">
            <Wallet className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-700">No payslips available yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {payslips.map((payslip) => (
            <Card key={payslip.id} className="rounded-2xl border-0 shadow-sm">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{payslip.period || "Payslip"}</p>
                  <p className="text-xs text-gray-500 capitalize">
                    {payslip.status || "pending"} · Net Pay {typeof payslip.netPay === "number" ? `₹${payslip.netPay.toLocaleString("en-IN")}` : "—"}
                  </p>
                </div>
                {payslip.payslipUrl ? (
                  <Link href={payslip.payslipUrl} target="_blank" className="inline-flex items-center rounded-xl bg-[#014c85] px-3 py-2 text-sm font-medium text-white">
                    <Download className="mr-1.5 h-4 w-4" />
                    Open
                  </Link>
                ) : (
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                    Waiting
                  </span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
