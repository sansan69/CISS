"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  orderBy,
} from "firebase/firestore";
import { startOfToday } from "date-fns";
import { useAppAuth } from "@/context/auth-context";
import { authorizedFetch } from "@/lib/api-client";
import { buildFirestoreAuditEvent } from "@/lib/firestore-audit";
import { useToast } from "@/hooks/use-toast";
import { useHaptics } from "@/hooks/use-haptics";
import type { Employee } from "@/types/employee";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  UserPlus,
  Search,
  X,
  CheckCircle2,
  ClipboardList,
  Users,
} from "lucide-react";
import type { WorkOrder } from "@/types/work-orders";
import { isWorkOrderAdminRole } from "@/lib/work-orders";

type WorkOrderExamFields = Pick<
  WorkOrder,
  "examName" | "examCode" | "recordStatus" | "importId" | "sourceFileName"
>;

// ── Types ────────────────────────────────────────────────────────────────────

// ── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name?: string, employeeId?: string) {
  const n = (name || "").trim();
  if (n) return n.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "NA";
  const id = (employeeId || "").trim();
  return id ? id.slice(-2).toUpperCase() : "NA";
}

function formatDate(ts: any): string {
  try {
    return ts
      .toDate()
      .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  } catch {
    return "—";
  }
}

// ── AssignGuardsDialog ────────────────────────────────────────────────────────

const AssignGuardsDialog: React.FC<{
  workOrder: WorkOrder;
  isOpen: boolean;
  onClose: () => void;
  availableGuards: Employee[];
  isLoadingGuards: boolean;
}> = ({ workOrder, isOpen, onClose, availableGuards, isLoadingGuards }) => {
  const { toast } = useToast();
  const { haptic } = useHaptics();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGuards, setSelectedGuards] = useState(
    Array.isArray(workOrder.assignedGuards) ? workOrder.assignedGuards : [],
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setSelectedGuards(
      Array.isArray(workOrder.assignedGuards) ? workOrder.assignedGuards : [],
    );
    setSearchTerm("");
  }, [workOrder]);

  const filteredGuards = useMemo(() => {
    if (!searchTerm) return availableGuards;
    const lc = searchTerm.toLowerCase();
    return availableGuards.filter(
      (g) =>
        (g.fullName || "").toLowerCase().includes(lc) ||
        (g.employeeId || "").toLowerCase().includes(lc),
    );
  }, [searchTerm, availableGuards]);

  const handleToggle = (guard: Employee) => {
    haptic("selection");
    const isSelected = selectedGuards.some((g) => g.uid === guard.id);
    setSelectedGuards((prev) =>
      isSelected
        ? prev.filter((g) => g.uid !== guard.id)
        : [
            ...prev,
            {
              uid: guard.id,
              name: guard.fullName as string,
              employeeId: guard.employeeId as string,
              gender: guard.gender as string,
            },
          ],
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await authorizedFetch(`/api/admin/work-orders/${workOrder.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          assignedGuards: selectedGuards,
          assignmentHistory: buildFirestoreAuditEvent(
            "work_order_assignments_updated",
            undefined,
            {
              siteId: workOrder.siteId,
              assignedGuardIds: selectedGuards.map((g) => g.uid),
              assignedCount: selectedGuards.length,
            },
          ),
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      haptic("success");
      toast({ title: "Saved", description: "Guard assignments updated." });
      onClose();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not save assignments." });
    } finally {
      setIsSaving(false);
    }
  };

  const maleCount = selectedGuards.filter((g) => g.gender === "Male").length;
  const femaleCount = selectedGuards.filter((g) => g.gender === "Female").length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex h-[min(92dvh,56rem)] w-[calc(100vw-1rem)] max-w-full flex-col gap-0 overflow-hidden p-0 sm:h-[85vh] sm:w-[90vw] md:max-w-4xl">
        <DialogHeader className="flex-shrink-0 border-b px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
          <DialogTitle className="pr-8 text-base leading-tight sm:text-xl">
            Assign Guards — {workOrder.siteName}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {formatDate(workOrder.date)} · {workOrder.district}
          </DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-hidden min-h-0 flex flex-col md:flex-row">
          {/* ── Mobile ── */}
          <div className="md:hidden flex flex-col flex-1 overflow-hidden min-h-0">
            <Tabs defaultValue="available" className="flex flex-col flex-1 overflow-hidden min-h-0 w-full">
              <div className="flex-shrink-0 border-b px-4 pt-2">
                <TabsList className="w-full grid grid-cols-2 h-auto p-1">
                  <TabsTrigger value="available" className="text-xs py-2.5">
                    Available ({filteredGuards.length})
                  </TabsTrigger>
                  <TabsTrigger value="assigned" className="text-xs py-2.5">
                    Assigned
                    <span
                      className={`ml-1.5 h-5 w-5 rounded-full text-[11px] font-bold flex items-center justify-center ${
                        selectedGuards.length >= workOrder.totalManpower
                          ? "bg-green-500 text-white"
                          : "bg-primary text-primary-foreground"
                      }`}
                    >
                      {selectedGuards.length}
                    </span>
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Available */}
              <TabsContent value="available" className="flex-1 overflow-hidden m-0 p-3 data-[state=active]:flex data-[state=active]:flex-col gap-3">
                <div className="relative flex-shrink-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or ID…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 h-11 text-base"
                  />
                </div>
                <div className="flex-shrink-0 grid grid-cols-3 rounded-lg border divide-x text-center">
                  <div className="py-2.5">
                    <p className="text-lg font-bold leading-none">{workOrder.maleGuardsRequired}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Male</p>
                  </div>
                  <div className="py-2.5">
                    <p className="text-lg font-bold leading-none">{workOrder.femaleGuardsRequired}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Female</p>
                  </div>
                  <div className="py-2.5">
                    <p className="text-lg font-bold leading-none">{workOrder.totalManpower}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Total</p>
                  </div>
                </div>
                <ScrollArea className="flex-1 min-h-0">
                  {isLoadingGuards ? (
                    <div className="flex items-center justify-center py-12 gap-3">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : filteredGuards.length === 0 ? (
                    <p className="text-center text-sm text-muted-foreground py-10">No guards found.</p>
                  ) : (
                    <div className="space-y-2 pb-2 pr-1">
                      {filteredGuards.map((guard) => {
                        const isSelected = selectedGuards.some((g) => g.uid === guard.id);
                        return (
                          <button
                            key={guard.id}
                            type="button"
                            onClick={() => handleToggle(guard)}
                            className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-all active:scale-[0.98] ${
                              isSelected ? "bg-primary/5 border-primary/30" : "bg-card border-border"
                            }`}
                          >
                            <div className="relative flex-shrink-0">
                              <Avatar className="h-11 w-11">
                                <AvatarImage src={guard.profilePictureUrl as string | undefined} />
                                <AvatarFallback className="text-xs">
                                  {getInitials(guard.fullName as string, guard.employeeId as string)}
                                </AvatarFallback>
                              </Avatar>
                              {isSelected && (
                                <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center ring-2 ring-background">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-primary-foreground" />
                                </span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm">{guard.fullName}</p>
                              <p className="text-xs text-muted-foreground">{guard.employeeId}</p>
                              <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0">{guard.gender}</Badge>
                            </div>
                            <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center transition-colors ${isSelected ? "bg-destructive/10" : "bg-muted"}`}>
                              {isSelected ? <X className="h-4 w-4 text-destructive" /> : <UserPlus className="h-4 w-4 text-muted-foreground" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* Assigned (mobile) */}
              <TabsContent value="assigned" className="flex-1 overflow-hidden m-0 p-3 data-[state=active]:flex data-[state=active]:flex-col gap-3">
                <div className="flex-shrink-0 grid grid-cols-2 rounded-lg border divide-x text-center">
                  <div className="py-3">
                    <p className="text-xl font-bold">{maleCount}<span className="text-sm text-muted-foreground font-normal">/{workOrder.maleGuardsRequired}</span></p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Male</p>
                  </div>
                  <div className="py-3">
                    <p className="text-xl font-bold">{femaleCount}<span className="text-sm text-muted-foreground font-normal">/{workOrder.femaleGuardsRequired}</span></p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Female</p>
                  </div>
                </div>
                <Progress
                  value={workOrder.totalManpower > 0 ? Math.min(100, (selectedGuards.length / workOrder.totalManpower) * 100) : 0}
                  className="h-2 flex-shrink-0"
                />
                <ScrollArea className="flex-1 min-h-0">
                  <div className="space-y-2 pr-1">
                    {selectedGuards.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8">
                        <UserPlus className="h-10 w-10 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No guards assigned yet.</p>
                      </div>
                    ) : selectedGuards.map((guard) => {
                      const details = availableGuards.find((g) => g.id === guard.uid);
                      return (
                        <div key={guard.uid} className="flex items-center gap-3 rounded-xl border p-3 bg-card">
                          <Avatar className="h-10 w-10 flex-shrink-0">
                            <AvatarImage src={details?.profilePictureUrl as string | undefined} />
                            <AvatarFallback className="text-xs">{getInitials(guard.name, guard.employeeId)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{guard.name}</p>
                            <p className="text-xs text-muted-foreground">{guard.employeeId}</p>
                          </div>
                          <Badge variant="outline" className="text-[10px] flex-shrink-0">{guard.gender}</Badge>
                          <Button size="sm" variant="ghost" onClick={() => setSelectedGuards((prev) => prev.filter((g) => g.uid !== guard.uid))} className="flex-shrink-0 h-8 w-8 p-0 hover:bg-destructive hover:text-destructive-foreground">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>

          {/* ── Desktop side-by-side ── */}
          <div className="hidden md:flex flex-1 overflow-hidden min-h-0">
            {/* Left: available */}
            <div className="flex flex-col flex-1 overflow-hidden min-h-0 border-r p-4 gap-3">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Available Guards ({filteredGuards.length})
              </p>
              <div className="relative flex-shrink-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or ID…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <ScrollArea className="flex-1 min-h-0">
                {isLoadingGuards ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : filteredGuards.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-10">No guards found.</p>
                ) : (
                  <div className="space-y-1.5 pr-2">
                    {filteredGuards.map((guard) => {
                      const isSelected = selectedGuards.some((g) => g.uid === guard.id);
                      return (
                        <button
                          key={guard.id}
                          type="button"
                          onClick={() => handleToggle(guard)}
                          className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all ${isSelected ? "bg-primary/5 border-primary/30" : "hover:bg-muted/50"}`}
                        >
                          <Avatar className="h-9 w-9 flex-shrink-0">
                            <AvatarImage src={guard.profilePictureUrl as string | undefined} />
                            <AvatarFallback className="text-xs">{getInitials(guard.fullName as string, guard.employeeId as string)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{guard.fullName}</p>
                            <p className="text-xs text-muted-foreground">{guard.employeeId}</p>
                          </div>
                          <Badge variant="outline" className="text-[10px] flex-shrink-0">{guard.gender}</Badge>
                          <div className={`flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center ${isSelected ? "bg-destructive/10" : "bg-muted"}`}>
                            {isSelected ? <X className="h-3.5 w-3.5 text-destructive" /> : <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Right: assigned */}
            <div className="flex flex-col w-80 flex-shrink-0 overflow-hidden min-h-0 p-4 gap-3">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Assigned ({selectedGuards.length}/{workOrder.totalManpower})
              </p>
              <div className="flex-shrink-0 grid grid-cols-3 rounded-lg border divide-x text-center">
                <div className="py-2">
                  <p className="text-base font-bold leading-none">{maleCount}<span className="text-xs text-muted-foreground">/{workOrder.maleGuardsRequired}</span></p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Male</p>
                </div>
                <div className="py-2">
                  <p className="text-base font-bold leading-none">{femaleCount}<span className="text-xs text-muted-foreground">/{workOrder.femaleGuardsRequired}</span></p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Female</p>
                </div>
                <div className="py-2">
                  <p className={`text-base font-bold leading-none ${selectedGuards.length >= workOrder.totalManpower ? "text-green-600" : "text-primary"}`}>{selectedGuards.length}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Total</p>
                </div>
              </div>
              <Progress value={workOrder.totalManpower > 0 ? Math.min(100, (selectedGuards.length / workOrder.totalManpower) * 100) : 0} className="h-1.5 flex-shrink-0" />
              <ScrollArea className="flex-1 min-h-0">
                <div className="space-y-1.5 pr-2">
                  {selectedGuards.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                      <UserPlus className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      <p className="text-xs">No guards assigned.</p>
                    </div>
                  ) : selectedGuards.map((guard) => {
                    const details = availableGuards.find((g) => g.id === guard.uid);
                    return (
                      <div key={guard.uid} className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2 bg-card">
                        <Avatar className="h-8 w-8 flex-shrink-0">
                          <AvatarImage src={details?.profilePictureUrl as string | undefined} />
                          <AvatarFallback className="text-[10px]">{getInitials(guard.name, guard.employeeId)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-xs truncate">{guard.name}</p>
                          <p className="text-[10px] text-muted-foreground">{guard.employeeId}</p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedGuards((prev) => prev.filter((g) => g.uid !== guard.uid))} className="h-7 w-7 p-0 hover:bg-destructive hover:text-destructive-foreground flex-shrink-0">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 border-t bg-background px-4 sm:px-6 py-3 sm:py-4 gap-2">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto">
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Assignments
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── WorkOrdersPanel ────────────────────────────────────────────────────────────

export function WorkOrdersPanel() {
  const { userRole, assignedDistricts } = useAppAuth();
  const { toast } = useToast();
  const isAdmin = isWorkOrderAdminRole(userRole);

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [availableGuards, setAvailableGuards] = useState<Employee[]>([]);
  const [isLoadingGuards, setIsLoadingGuards] = useState(false);

  const activeWorkOrders = useMemo(
    () =>
      workOrders.filter(
        (order) => (order.recordStatus ?? "active").trim().toLowerCase() === "active",
      ),
    [workOrders],
  );

  // ── Fetch work orders ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAdmin && assignedDistricts.length === 0) {
      setIsLoading(false);
      return;
    }

    const today = startOfToday();

    let q;
    if (isAdmin) {
      q = query(
        collection(db, "workOrders"),
        where("date", ">=", today),
        orderBy("date", "asc"),
      );
    } else {
      q = query(
        collection(db, "workOrders"),
        where("district", "in", assignedDistricts),
        where("date", ">=", today),
        orderBy("date", "asc"),
      );
    }

    const unsub = onSnapshot(
      q,
      (snap) => {
        setWorkOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkOrder)));
        setIsLoading(false);
      },
      () => {
        toast({ variant: "destructive", title: "Error", description: "Could not load work orders." });
        setIsLoading(false);
      },
    );

    return () => unsub();
  }, [isAdmin, assignedDistricts, toast]);

  // ── Group by site ──────────────────────────────────────────────────────────
  const ordersBySite = useMemo(() => {
    const map = new Map<string, { siteName: string; clientName: string; district: string; orders: WorkOrder[] }>();
    for (const order of activeWorkOrders) {
      const existing = map.get(order.siteId);
      if (existing) {
        existing.orders.push(order);
      } else {
        map.set(order.siteId, {
          siteName: order.siteName,
          clientName: order.clientName,
          district: order.district,
          orders: [order],
        });
      }
    }
    return Array.from(map.entries()).map(([siteId, val]) => ({ siteId, ...val }));
  }, [activeWorkOrders]);

  // ── Open assign dialog ─────────────────────────────────────────────────────
  const handleOpenAssign = useCallback(async (order: WorkOrder) => {
    setSelectedWorkOrder(order);
    setIsLoadingGuards(true);
    try {
      const districtsToQuery = isAdmin ? [order.district] : assignedDistricts;
      if (districtsToQuery.length === 0) { setAvailableGuards([]); setIsLoadingGuards(false); return; }
      const snap = await getDocs(
        query(
          collection(db, "employees"),
          where("district", "in", districtsToQuery),
          where("status", "==", "Active"),
        ),
      );
      setAvailableGuards(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not load guards." });
    } finally {
      setIsLoadingGuards(false);
    }
  }, [isAdmin, assignedDistricts, toast]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!isAdmin && assignedDistricts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm">
        No districts assigned to your account.
      </div>
    );
  }

  if (ordersBySite.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <ClipboardList className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No upcoming work orders for your districts.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {ordersBySite.map(({ siteId, siteName, clientName, district, orders }) => (
          <Card key={siteId} className="overflow-hidden">
            {/* Site header */}
            <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3 border-b bg-muted/30">
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{siteName}</p>
                <p className="text-xs text-muted-foreground truncate">{clientName}</p>
              </div>
              <Badge variant="secondary" className="shrink-0 text-[10px]">{district}</Badge>
            </div>

            <CardContent className="p-0">
              <div className="divide-y">
                {orders.map((order) => {
                  const totalRequired = order.totalManpower || (order.maleGuardsRequired + order.femaleGuardsRequired);
                  const assignedGuards = Array.isArray(order.assignedGuards) ? order.assignedGuards : [];
                  const assignedCount = assignedGuards.length;
                  const percent = totalRequired > 0 ? Math.min(100, Math.round((assignedCount / totalRequired) * 100)) : 0;
                  const isFullyAssigned = assignedCount >= totalRequired && totalRequired > 0;
                  const isUnassigned = assignedCount === 0;

                  const statusColor = isUnassigned
                    ? "text-red-600"
                    : isFullyAssigned
                      ? "text-green-600"
                      : "text-amber-600";

                  const statusLabel = isUnassigned ? "Unassigned" : isFullyAssigned ? "Full" : "Partial";
                  const statusBadgeClass = isUnassigned
                    ? "bg-red-100 text-red-700 border-red-200"
                    : isFullyAssigned
                      ? "bg-green-100 text-green-700 border-green-200"
                      : "bg-amber-100 text-amber-700 border-amber-200";

                  return (
                    <div key={order.id} className="p-4">
                      {/* Date + status */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{formatDate(order.date)}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {order.examName || order.examCode || "General Duty"}
                          </p>
                        </div>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass}`}>
                          {statusLabel}
                        </span>
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-4 gap-2 text-center mb-3">
                        <div>
                          <p className="text-base font-bold leading-none">{order.maleGuardsRequired}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Male</p>
                        </div>
                        <div>
                          <p className="text-base font-bold leading-none">{order.femaleGuardsRequired}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Female</p>
                        </div>
                        <div>
                          <p className="text-base font-bold leading-none">{totalRequired}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Required</p>
                        </div>
                        <div>
                          <p className={`text-base font-bold leading-none ${statusColor}`}>{assignedCount}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Assigned</p>
                        </div>
                      </div>

                      {/* Progress */}
                      <Progress value={percent} className="h-1.5 mb-3" />

                      {/* Assigned guards preview */}
                      {assignedCount > 0 && (
                        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                          <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {assignedGuards.slice(0, 4).map((g) => (
                            <span key={g.uid} className="text-xs bg-muted rounded-full px-2 py-0.5 truncate max-w-[100px]">
                              {g.name}
                            </span>
                          ))}
                          {assignedCount > 4 && (
                            <span className="text-xs text-muted-foreground">+{assignedCount - 4} more</span>
                          )}
                        </div>
                      )}

                      {/* Assign button */}
                      <Button
                        size="sm"
                        variant={isUnassigned ? "default" : "outline"}
                        className="w-full"
                        onClick={() => handleOpenAssign(order)}
                      >
                        <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                        {isUnassigned ? "Assign Guards" : "Edit Assignment"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedWorkOrder && (
        <AssignGuardsDialog
          workOrder={selectedWorkOrder}
          isOpen={!!selectedWorkOrder}
          onClose={() => setSelectedWorkOrder(null)}
          availableGuards={availableGuards}
          isLoadingGuards={isLoadingGuards}
        />
      )}
    </>
  );
}
