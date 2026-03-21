"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, Plus, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAppAuth } from "@/context/auth-context";

type GuardLeaveBalance = {
  casual: { entitled: number; taken: number; balance: number };
  sick: { entitled: number; taken: number; balance: number };
  earned: { entitled: number; taken: number; balance: number };
} | null;

type GuardLeaveRequest = {
  id: string;
  type: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: string;
  createdAt?: string;
  notes?: string;
};

function formatDate(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function BalanceCard({
  label,
  stats,
}: {
  label: string;
  stats: { entitled: number; taken: number; balance: number };
}) {
  return (
    <Card className="rounded-2xl border-0 shadow-sm">
      <CardContent className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        <p className="mt-2 text-2xl font-bold text-gray-900">{stats.balance}</p>
        <p className="mt-1 text-xs text-gray-500">
          Taken {stats.taken} of {stats.entitled}
        </p>
      </CardContent>
    </Card>
  );
}

export default function GuardLeavePage() {
  const { user } = useAppAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [balance, setBalance] = useState<GuardLeaveBalance>(null);
  const [requests, setRequests] = useState<GuardLeaveRequest[]>([]);
  const [form, setForm] = useState({
    type: "casual",
    fromDate: "",
    toDate: "",
    reason: "",
  });

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/guard/leave", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load leave data.");
      setBalance(data.balance ?? null);
      setRequests(data.requests ?? []);
    } catch (error: any) {
      toast({
        title: "Could not load leave data",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totalBalance = useMemo(() => {
    if (!balance) return null;
    return balance.casual.balance + balance.sick.balance + balance.earned.balance;
  }, [balance]);

  const handleSubmit = async () => {
    if (!user) return;
    if (!form.fromDate || !form.toDate || !form.reason.trim()) {
      toast({
        title: "Missing details",
        description: "Choose dates and add a short reason.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/guard/leave", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not submit leave request.");

      toast({ title: "Leave request submitted" });
      setSheetOpen(false);
      setForm({ type: "casual", fromDate: "", toDate: "", reason: "" });
      await loadData();
    } catch (error: any) {
      toast({
        title: "Submit failed",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (requestId: string) => {
    if (!user) return;
    setCancellingId(requestId);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/guard/leave", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not cancel leave request.");
      toast({ title: "Leave request cancelled" });
      await loadData();
    } catch (error: any) {
      toast({
        title: "Cancel failed",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-4 p-4 pb-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Leave & absence</p>
          <h1 className="text-lg font-bold text-gray-900">My Leave</h1>
        </div>
        <Button className="rounded-xl bg-[#014c85] hover:bg-[#013a6b]" onClick={() => setSheetOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Request
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : (
        <>
          <Card className="rounded-2xl border-0 bg-[#014c85] text-white shadow-sm">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/70">Available leave</p>
                <p className="mt-1 text-3xl font-bold">{totalBalance ?? "—"}</p>
              </div>
              <CalendarDays className="h-8 w-8 text-[#bd9c55]" />
            </CardContent>
          </Card>

          {balance && (
            <div className="grid grid-cols-3 gap-3">
              <BalanceCard label="Casual" stats={balance.casual} />
              <BalanceCard label="Sick" stats={balance.sick} />
              <BalanceCard label="Earned" stats={balance.earned} />
            </div>
          )}

          <div className="space-y-3">
            {requests.length === 0 ? (
              <Card className="rounded-2xl border-0 shadow-sm">
                <CardContent className="py-12 text-center">
                  <Clock3 className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-3 text-sm font-medium text-gray-700">No leave requests yet</p>
                </CardContent>
              </Card>
            ) : (
              requests.map((request) => (
                <Card key={request.id} className="rounded-2xl border-0 shadow-sm">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold capitalize text-gray-900">{request.type} leave</p>
                        <p className="text-xs text-gray-500">
                          {request.days} day{request.days !== 1 ? "s" : ""} · {formatDate(request.fromDate)} to {formatDate(request.toDate)}
                        </p>
                      </div>
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium capitalize text-gray-700">
                        {request.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{request.reason}</p>
                    {request.notes ? (
                      <p className="text-xs text-gray-500">Notes: {request.notes}</p>
                    ) : null}
                    {request.status === "pending" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        disabled={cancellingId === request.id}
                        onClick={() => handleCancel(request.id)}
                      >
                        <XCircle className="mr-1.5 h-4 w-4" />
                        Cancel request
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[92vh] rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>New Leave Request</SheetTitle>
            <SheetDescription>Choose the leave type, dates, and a short reason.</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label>Leave Type</Label>
              <Select value={form.type} onValueChange={(value) => setForm((current) => ({ ...current, type: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="casual">Casual Leave</SelectItem>
                  <SelectItem value="sick">Sick Leave</SelectItem>
                  <SelectItem value="earned">Earned Leave</SelectItem>
                  <SelectItem value="unpaid">Unpaid Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>From</Label>
                <Input type="date" value={form.fromDate} onChange={(e) => setForm((current) => ({ ...current, fromDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>To</Label>
                <Input type="date" value={form.toDate} onChange={(e) => setForm((current) => ({ ...current, toDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea rows={4} value={form.reason} onChange={(e) => setForm((current) => ({ ...current, reason: e.target.value }))} placeholder="Briefly tell us why you need leave." />
            </div>
            <Button className="w-full rounded-xl bg-[#014c85] hover:bg-[#013a6b]" disabled={submitting} onClick={handleSubmit}>
              {submitting ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
