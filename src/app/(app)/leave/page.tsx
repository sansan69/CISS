"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAppAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Plus, CheckCircle2, XCircle, Clock, CalendarDays } from "lucide-react";
import type { LeaveRequest, LeaveType, LeaveStatus } from "@/types/leave";
import { cn } from "@/lib/utils";

type Tab = "pending" | "approved" | "rejected" | "all";

const LEAVE_TYPE_CONFIG: Record<LeaveType, { label: string; className: string }> = {
  casual: { label: "CL", className: "bg-blue-100 text-blue-700" },
  sick: { label: "SL", className: "bg-amber-100 text-amber-700" },
  earned: { label: "EL", className: "bg-green-100 text-green-700" },
  unpaid: { label: "UL", className: "bg-gray-100 text-gray-600" },
};

const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

function formatDate(ts: { seconds: number } | string | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "string" ? new Date(ts) : new Date((ts as { seconds: number }).seconds * 1000);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function LeavePage() {
  const { userRole, user } = useAppAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>("pending");
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  // New request form
  const [form, setForm] = useState({
    employeeId: "",
    employeeName: "",
    employeeCode: "",
    clientId: "",
    clientName: "",
    district: "",
    type: "casual" as LeaveType,
    fromDate: "",
    toDate: "",
    reason: "",
  });

  const isAdmin = userRole === "admin" || userRole === "superAdmin";

  const loadRequests = useCallback(async (tab: Tab) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (tab !== "all") params.set("status", tab);
      const res = await authorizedFetch(`/api/admin/leave/requests?${params.toString()}`);
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch {
      toast({ title: "Error", description: "Failed to load leave requests", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadRequests(activeTab); }, [activeTab, loadRequests]);

  const calculateDays = (from: string, to: string): number => {
    if (!from || !to) return 0;
    const d1 = new Date(from);
    const d2 = new Date(to);
    return Math.max(1, Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  };

  const handleSubmit = async () => {
    const { fromDate, toDate, employeeId, reason, type } = form;
    if (!employeeId || !fromDate || !toDate || !reason || !type) {
      toast({ title: "Missing fields", description: "Please fill all required fields.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await authorizedFetch("/api/admin/leave/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          days: calculateDays(fromDate, toDate),
        }),
      });
      if (!res.ok) throw new Error("Submit failed");
      toast({ title: "Submitted", description: "Leave request created." });
      setSheetOpen(false);
      setForm({
        employeeId: "", employeeName: "", employeeCode: "",
        clientId: "", clientName: "", district: "",
        type: "casual", fromDate: "", toDate: "", reason: "",
      });
      loadRequests(activeTab);
    } catch {
      toast({ title: "Error", description: "Failed to submit request", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const respond = async (id: string, status: LeaveStatus, notes?: string) => {
    setRespondingId(id);
    try {
      const res = await authorizedFetch(`/api/admin/leave/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes }),
      });
      if (!res.ok) throw new Error("Respond failed");
      toast({ title: status === "approved" ? "Approved" : "Rejected", description: "Leave request updated." });
      loadRequests(activeTab);
    } catch {
      toast({ title: "Error", description: "Failed to respond", variant: "destructive" });
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Leave Management"
        description="Manage employee leave requests"
        actions={
          isAdmin ? (
            <Button onClick={() => setSheetOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> New Request
            </Button>
          ) : undefined
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              activeTab === tab.key
                ? "border-brand-blue text-brand-blue"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CalendarDays className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              No {activeTab !== "all" ? activeTab : ""} leave requests found.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const typeConfig = LEAVE_TYPE_CONFIG[req.type];
            const isResponding = respondingId === req.id;
            return (
              <Card key={req.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-bold", typeConfig.className)}>
                          {typeConfig.label}
                        </span>
                        <span className="font-semibold text-sm truncate">{req.employeeName}</span>
                        {req.employeeCode && (
                          <span className="text-xs text-muted-foreground">{req.employeeCode}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-1">
                        {req.clientName} · {req.district}
                      </p>
                      <p className="text-sm">
                        {formatDate(req.fromDate as unknown as { seconds: number })}
                        {" "}—{" "}
                        {formatDate(req.toDate as unknown as { seconds: number })}
                        <span className="ml-2 text-xs font-medium text-muted-foreground">
                          ({req.days} day{req.days !== 1 ? "s" : ""})
                        </span>
                      </p>
                      {req.reason && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">{req.reason}</p>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {/* Status */}
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium",
                        req.status === "approved" ? "bg-green-100 text-green-700" :
                        req.status === "rejected" ? "bg-red-100 text-red-700" :
                        "bg-amber-100 text-amber-700"
                      )}>
                        {req.status === "approved" ? <CheckCircle2 className="h-3 w-3" /> :
                         req.status === "rejected" ? <XCircle className="h-3 w-3" /> :
                         <Clock className="h-3 w-3" />}
                        {req.status}
                      </span>

                      {/* Approve/Reject for pending */}
                      {req.status === "pending" && isAdmin && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                            disabled={isResponding}
                            onClick={() => respond(req.id, "rejected")}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            className="h-8 bg-green-600 hover:bg-green-700"
                            disabled={isResponding}
                            onClick={() => respond(req.id, "approved")}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            Approve
                          </Button>
                        </div>
                      )}

                      {req.approvedByName && req.status !== "pending" && (
                        <p className="text-xs text-muted-foreground">{req.status === "approved" ? "Approved" : "Rejected"} by {req.approvedByName}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New Request Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Leave Request</SheetTitle>
            <SheetDescription>Create a leave request for an employee</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Employee ID *</Label>
                <Input
                  value={form.employeeId}
                  onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
                  placeholder="Employee ID"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Employee Name</Label>
                <Input
                  value={form.employeeName}
                  onChange={(e) => setForm((f) => ({ ...f, employeeName: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Employee Code</Label>
                <Input
                  value={form.employeeCode}
                  onChange={(e) => setForm((f) => ({ ...f, employeeCode: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Client Name</Label>
                <Input
                  value={form.clientName}
                  onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>District</Label>
                <Input
                  value={form.district}
                  onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Leave Type *</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as LeaveType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="casual">Casual Leave (CL)</SelectItem>
                  <SelectItem value="sick">Sick Leave (SL)</SelectItem>
                  <SelectItem value="earned">Earned Leave (EL)</SelectItem>
                  <SelectItem value="unpaid">Unpaid Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>From Date *</Label>
                <Input
                  type="date"
                  value={form.fromDate}
                  onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>To Date *</Label>
                <Input
                  type="date"
                  value={form.toDate}
                  min={form.fromDate}
                  onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))}
                />
              </div>
            </div>

            {form.fromDate && form.toDate && (
              <p className="text-sm text-muted-foreground">
                Duration: <strong>{calculateDays(form.fromDate, form.toDate)} day(s)</strong>
              </p>
            )}

            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <Input
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Reason for leave..."
              />
            </div>

            <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
