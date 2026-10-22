"use client";

import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {Timestamp} from 'firebase/firestore';
import {WorkOrderWillingness} from './work-order-willingness';
import {GuardAssignmentsPanel} from './guard-assignments-panel';
import {useDutySchedulingEnabled,useScopedDutyOrders} from './use-duty-scheduling';
import {loadWorkOrderRoster,retainedRosterMutation,submitRosterRequest,type DutyMutation,type WorkOrderRoster} from './duty-scheduling';
import { useAppAuth } from "@/context/auth-context";
import { authorizedFetch } from "@/lib/api-client";
import { formatIstDate, formatIstDutyDateLabel } from "@/lib/ist-date";
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
  SpinnerGap as Loader2,
  UserPlus,
  MagnifyingGlass as Search,
  X,
  CheckCircle as CheckCircle2,
  Users,
  CaretDown as ChevronDown,
  CaretRight as ChevronRight,
} from "@phosphor-icons/react";
import type { WorkOrder } from "@/types/work-orders";
import { isWorkOrderAdminRole } from "@/lib/work-orders";
import { fetchActiveGuardsForDistricts } from "@/lib/work-orders/available-guards";
import {
  countGuardAssignments,
  getGuardAssignmentCapacityIssue,
} from "@/lib/work-orders/guard-assignment-capacity";
import { WorkOrderRevisionNotices } from "@/components/work-orders/revision-notices";
import {
  canDismissManualRoster,
  isCurrentRosterRead,
  isManualRosterSelectionLocked,
} from "./manual-roster-lifecycle";

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
    // The duty date is canonical IST; formatting it in the browser's own zone
    // would show the previous day for an IST-midnight duty.
    return formatIstDutyDateLabel(ts.toDate());
  } catch {
    return "—";
  }
}

// ── AssignGuardsDialog ────────────────────────────────────────────────────────

export const AssignGuardsDialog: React.FC<{
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
  const [roster, setRoster] = useState<WorkOrderRoster | null>(null);
  const [isLoadingRoster, setIsLoadingRoster] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const pendingSave = useRef<DutyMutation | null>(null);
  const rosterReadId = useRef(0);

  const loadRoster = useCallback(async () => {
    const requestId = ++rosterReadId.current;
    setIsLoadingRoster(true);
    setRosterError("");
    setRoster(null);
    try {
      const current = await loadWorkOrderRoster(workOrder.id, authorizedFetch);
      if (!isCurrentRosterRead(requestId, rosterReadId.current)) return;
      setRoster(current);
      // Show the authoritative roster so a save can only be built from the
      // version the supervisor actually sees.
      setSelectedGuards(current.assignedGuards);
      setSearchTerm("");
    } catch (error) {
      if (!isCurrentRosterRead(requestId, rosterReadId.current)) return;
      setRoster(null);
      setRosterError(
        error instanceof Error ? error.message : "Could not load the current roster.",
      );
    } finally {
      if (isCurrentRosterRead(requestId, rosterReadId.current)) {
        setIsLoadingRoster(false);
      }
    }
  }, [workOrder.id]);

  // Read the current roster and assignmentVersion whenever the manual editor opens.
  useEffect(() => {
    if (!isOpen) return;
    pendingSave.current = null;
    setSaveError("");
    setUncertain(false);
    void loadRoster();
  }, [isOpen, loadRoster]);

  const filteredGuards = useMemo(() => {
    if (!searchTerm) return availableGuards;
    const lc = searchTerm.toLowerCase();
    return availableGuards.filter(
      (g) =>
        (g.fullName || "").toLowerCase().includes(lc) ||
        (g.employeeId || "").toLowerCase().includes(lc),
    );
  }, [searchTerm, availableGuards]);

  // While a save is in flight or unconfirmed the selector must keep showing the
  // roster that the retained receipt was built from.
  const lifecycleState = {
    isSaving,
    isUnconfirmed: uncertain,
    isLoadingRoster,
    hasAuthoritativeRoster: roster !== null,
  };
  const selectionLocked = isManualRosterSelectionLocked(lifecycleState);
  const canDismiss = canDismissManualRoster(lifecycleState);
  const handleOpenChange = (open: boolean) => {
    if (!open && canDismiss) onClose();
  };

  const removeGuard = (uid: string) => {
    if (selectionLocked) return;
    setSelectedGuards((prev) => prev.filter((g) => g.uid !== uid));
  };

  const handleToggle = (guard: Employee) => {
    if (selectionLocked) return;
    haptic("selection");
    const isSelected = selectedGuards.some((g) => g.uid === guard.id);
    if (!isSelected) {
      const issue = getGuardAssignmentCapacityIssue(
        selectedGuards,
        guard.gender,
        workOrder,
      );
      if (issue) {
        toast({
          variant: "destructive",
          title: issue.title,
          description: issue.description,
        });
        return;
      }
    }
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
    if (!roster) {
      setSaveError("Reload the current roster before saving assignments.");
      return;
    }
    setIsSaving(true);
    setSaveError("");
    try {
      // One request, one receipt: an unconfirmed retry re-issues this exact
      // body and version instead of overwriting whatever landed meanwhile.
      const request = retainedRosterMutation(
        pendingSave.current,
        workOrder.id,
        selectedGuards,
        roster.assignmentVersion,
        () => crypto.randomUUID(),
      );
      pendingSave.current = request;
      const outcome = await submitRosterRequest(request, authorizedFetch);
      if (outcome.status === "saved") {
        pendingSave.current = null;
        setUncertain(false);
        haptic("success");
        toast({ title: "Saved", description: "Guard assignments updated." });
        onClose();
        return;
      }
      pendingSave.current = outcome.retryable ? request : null;
      setUncertain(outcome.retryable);
      setSaveError(
        outcome.versionConflict
          ? `${outcome.message} Reload the current roster and reselect the guards before saving.`
          : outcome.message,
      );
      // A newer roster is authoritative: refresh it and require reselection.
      if (outcome.versionConflict) await loadRoster();
      if (!outcome.retryable) {
        toast({
          variant: "destructive",
          title: "Assignment not saved",
          description: outcome.message,
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const { male: maleCount, female: femaleCount } =
    countGuardAssignments(selectedGuards);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        closeDisabled={!canDismiss}
        onEscapeKeyDown={(event) => { if (!canDismiss) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (!canDismiss) event.preventDefault(); }}
        className="flex h-[min(92dvh,56rem)] w-[calc(100vw-1rem)] max-w-full flex-col gap-0 overflow-hidden p-0 sm:h-[85vh] sm:w-[90vw] md:max-w-4xl"
      >
        <DialogHeader className="flex-shrink-0 border-b px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
          <DialogTitle className="pr-8 text-base leading-tight sm:text-xl">
            Assign Guards — {workOrder.siteName}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {formatDate(workOrder.date)} · {workOrder.district}
          </DialogDescription>
        </DialogHeader>

        {isLoadingRoster && (
          <p role="status" className="flex-shrink-0 px-4 pt-3 text-sm text-muted-foreground sm:px-6">
            Loading the current roster…
          </p>
        )}
        {rosterError && (
          <div role="alert" className="flex-shrink-0 px-4 pt-3 sm:px-6">
            <p className="text-sm text-destructive">{rosterError}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void loadRoster()}>
              Reload roster
            </Button>
          </div>
        )}

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
                          ? "bg-success text-white"
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
                            disabled={selectionLocked}
                            className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-all active:brightness-[0.92] ${
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
                          <Button size="sm" variant="ghost" disabled={selectionLocked} onClick={() => removeGuard(guard.uid)} className="flex-shrink-0 h-8 w-8 p-0 hover:bg-destructive hover:text-destructive-foreground">
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
                          disabled={selectionLocked}
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
                  <p className={`text-base font-bold leading-none ${selectedGuards.length >= workOrder.totalManpower ? "text-success" : "text-primary"}`}>{selectedGuards.length}</p>
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
                        <Button size="sm" variant="ghost" disabled={selectionLocked} onClick={() => removeGuard(guard.uid)} className="h-7 w-7 p-0 hover:bg-destructive hover:text-destructive-foreground flex-shrink-0">
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

        {saveError && (
          <div role="alert" className="flex-shrink-0 border-t px-4 py-3 sm:px-6">
            <p className="text-sm text-destructive">{saveError}</p>
            {uncertain && (
              <p className="mt-1 text-xs text-muted-foreground">
                Retry sends this same request with the same receipt.
              </p>
            )}
          </div>
        )}
        <DialogFooter className="flex-shrink-0 border-t bg-background px-4 sm:px-6 py-3 sm:py-4 gap-2">
          <Button variant="outline" onClick={onClose} disabled={!canDismiss} className="w-full sm:w-auto">Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving || isLoadingRoster || !!rosterError} className="w-full sm:w-auto">
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {uncertain ? "Retry assignments" : "Save Assignments"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── WorkOrdersPanel ────────────────────────────────────────────────────────────

export function WorkOrdersPanel() {
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const isAdmin = isWorkOrderAdminRole(userRole);

  const enabled=useDutySchedulingEnabled();
  const {orders:scopedOrders,loading:isLoading,error:loadError,reload}=useScopedDutyOrders(enabled);
  const workOrders=useMemo(()=>scopedOrders.map(order=>({...order,date:Timestamp.fromDate(new Date(order.date)),recordStatus:'active'} as WorkOrder)),[scopedOrders]);
  const siteDistricts=useMemo(()=>Object.fromEntries(scopedOrders.map(order=>[order.siteId,order.district])),[scopedOrders]);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [availableGuards, setAvailableGuards] = useState<Employee[]>([]);
  const [isLoadingGuards, setIsLoadingGuards] = useState(false);
  const [collapsedDateKeys, setCollapsedDateKeys] = useState<Set<string>>(new Set());
  const activeWorkOrders = useMemo(()=>workOrders.filter(order=>(order.recordStatus ?? "active").trim().toLowerCase()==='active'),[workOrders]);

  // ── Group by duty date ─────────────────────────────────────────────────────
  const ordersByDate = useMemo(() => {
    const map = new Map<string, { dateLabel: string; orders: WorkOrder[] }>();
    for (const order of activeWorkOrders) {
      const dateLabel = formatDate(order.date);
      const dateKey = (() => {
        try {
          return formatIstDate(order.date.toDate());
        } catch {
          return dateLabel;
        }
      })();
      const existing = map.get(dateKey);
      if (existing) {
        existing.orders.push(order);
      } else {
        map.set(dateKey, {
          dateLabel,
          orders: [order],
        });
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, val]) => ({
        dateKey,
        dateLabel: val.dateLabel,
        orders: [...val.orders].sort((a, b) => {
          const districtCompare = (a.district || "").localeCompare(b.district || "");
          if (districtCompare !== 0) return districtCompare;
          const siteCompare = (a.siteName || "").localeCompare(b.siteName || "");
          if (siteCompare !== 0) return siteCompare;
          return (a.examName || a.examCode || "").localeCompare(b.examName || b.examCode || "");
        }),
      }));
  }, [activeWorkOrders]);

  const toggleDateGroup = useCallback((dateKey: string) => {
    setCollapsedDateKeys((current) => {
      const next = new Set(current);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  }, []);

  // ── Open assign dialog ─────────────────────────────────────────────────────
  const handleOpenAssign = useCallback(async (order: WorkOrder) => {
    setSelectedWorkOrder(order);
    setIsLoadingGuards(true);
    try {
      const districtScope = (siteDistricts[order.siteId] || order.district || "").trim();
      let scope: string[];
      if (isAdmin) {
        scope = districtScope ? [districtScope] : [];
        if (!districtScope) {
          toast({
            variant: "destructive",
            title: "Missing district",
            description: "This site has no district set. Showing all active guards.",
          });
        }
      } else {
        scope = districtScope ? [districtScope] : [];
      }
      const guards = await fetchActiveGuardsForDistricts(scope, { allowEmptyScope: isAdmin });
      setAvailableGuards(guards);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not load guards." });
    } finally {
      setIsLoadingGuards(false);
    }
  }, [isAdmin, siteDistricts, toast]);

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

  if(!enabled) return <p className="text-sm text-muted-foreground">Work orders are currently unavailable.</p>;
  if(loadError) return <div role="alert" className="space-y-3"><p className="text-sm text-destructive">{loadError}</p><Button variant="outline" onClick={reload}>Retry</Button></div>;
  if (ordersByDate.length === 0) {
    return <div className="space-y-4"><GuardAssignmentsPanel enabled={enabled}/><div className="rounded-xl border border-dashed p-10 text-center"><p className="text-sm text-muted-foreground">No upcoming exam work orders for your districts.</p></div></div>;
  }

  return (
    <>
      <div className="space-y-4">
        <WorkOrderRevisionNotices />
        <GuardAssignmentsPanel enabled={enabled}/>
        {ordersByDate.map(({ dateKey, dateLabel, orders }) => {
          const dateTotalRequired = orders.reduce((sum, order) => sum + (order.totalManpower || (order.maleGuardsRequired + order.femaleGuardsRequired)), 0);
          const dateAssignedCount = orders.reduce((sum, order) => {
            const assignedGuards = Array.isArray(order.assignedGuards) ? order.assignedGuards : [];
            return sum + assignedGuards.length;
          }, 0);
          const datePendingCount = orders.reduce((sum, order) => {
            const assignedGuards = Array.isArray(order.assignedGuards) ? order.assignedGuards : [];
            const assignedMale = assignedGuards.filter(
              (guard) => String(guard.gender ?? "").trim().toLowerCase() === "male",
            ).length;
            const assignedFemale = assignedGuards.filter(
              (guard) => String(guard.gender ?? "").trim().toLowerCase() === "female",
            ).length;
            return (
              sum +
              Math.max(0, order.maleGuardsRequired - assignedMale) +
              Math.max(0, order.femaleGuardsRequired - assignedFemale)
            );
          }, 0);
          const dateNeedsReview = orders.some((order) => {
            return (
              order.assignmentReviewRequired === true ||
              order.assignmentStatus === "review"
            );
          });
          const dateIsReady =
            !dateNeedsReview &&
            datePendingCount === 0 &&
            dateTotalRequired > 0;
          const isCollapsed = collapsedDateKeys.has(dateKey);
          const ToggleIcon = isCollapsed ? ChevronRight : ChevronDown;

          return (
            <Card key={dateKey} className="overflow-hidden border-border/70">
              <button
                type="button"
                onClick={() => toggleDateGroup(dateKey)}
                aria-expanded={!isCollapsed}
                aria-controls={`work-orders-date-${dateKey}`}
                className="flex w-full items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background shadow-brand-sm">
                    <ToggleIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{dateLabel}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {orders.length} dut{orders.length === 1 ? "y" : "ies"} · Assigned {dateAssignedCount}/{dateTotalRequired}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Badge variant={dateIsReady ? "default" : "secondary"} className="shrink-0 text-[10px]">
                    {dateIsReady ? "Ready" : dateNeedsReview ? "Review assignments" : `${datePendingCount} pending`}
                  </Badge>
                  <span className="text-[11px] font-medium text-primary">
                    {isCollapsed ? "View details" : "Hide details"}
                  </span>
                </div>
              </button>

              {!isCollapsed && (
                <CardContent id={`work-orders-date-${dateKey}`} className="p-0">
                  <div className="divide-y">
                    {orders.map((order) => {
                      const totalRequired = order.totalManpower || (order.maleGuardsRequired + order.femaleGuardsRequired);
                      const assignedGuards = Array.isArray(order.assignedGuards) ? order.assignedGuards : [];
                      const assignedCount = assignedGuards.length;
                      const percent = totalRequired > 0 ? Math.min(100, Math.round((assignedCount / totalRequired) * 100)) : 0;
                      const assignedMale = assignedGuards.filter(
                        (guard) => String(guard.gender ?? "").trim().toLowerCase() === "male",
                      ).length;
                      const assignedFemale = assignedGuards.filter(
                        (guard) => String(guard.gender ?? "").trim().toLowerCase() === "female",
                      ).length;
                      const isFullyAssigned =
                        totalRequired > 0 &&
                        assignedMale >= order.maleGuardsRequired &&
                        assignedFemale >= order.femaleGuardsRequired;
                      const isUnassigned = assignedCount === 0;
                      const needsAssignmentReview =
                        order.assignmentReviewRequired === true ||
                        order.assignmentStatus === "review";

                      const statusColor = needsAssignmentReview
                        ? "text-destructive"
                        : isUnassigned
                        ? "text-destructive"
                        : isFullyAssigned
                          ? "text-success"
                          : "text-warning-strong";

                      const statusLabel = needsAssignmentReview
                        ? "Review"
                        : isUnassigned
                          ? "Unassigned"
                          : isFullyAssigned
                            ? "Ready"
                            : "Partial";
                      const statusBadgeClass = needsAssignmentReview
                        ? "bg-destructive/15 text-destructive border-destructive/30"
                        : isUnassigned
                        ? "bg-destructive/15 text-destructive border-destructive/30"
                        : isFullyAssigned
                          ? "bg-success/15 text-success border-success/30"
                          : "bg-warning/15 text-warning-strong border-warning/30";

                      return (
                        <div key={order.id} className="p-4">
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-2">
                                <p className="truncate text-sm font-medium">{order.siteName}</p>
                                {(order.revisionNumber ?? 1) > 1 && (
                                  <Badge variant="outline" className="shrink-0 text-[10px]">
                                    {order.lastRevisionChange === "added"
                                      ? "New centre"
                                      : order.lastRevisionChange === "reactivated"
                                        ? "Reactivated"
                                        : "Revised"}
                                  </Badge>
                                )}
                              </div>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {order.examName || order.examCode || "General Duty"} · {order.district}
                              </p>
                            </div>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass}`}>
                              {statusLabel}
                            </span>
                          </div>

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

                          <Progress value={percent} className="h-1.5 mb-3" />

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

                          <div className="mb-3"><WorkOrderWillingness workOrderId={order.id} siteName={order.siteName} enabled={enabled} counts={scopedOrders.find(o=>o.id===order.id)} onSaved={reload}/></div>
                          <Button
                            size="sm"
                            variant={isUnassigned || needsAssignmentReview ? "default" : "outline"}
                            className="w-full"
                            onClick={() => handleOpenAssign(order)}
                          >
                            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                            {needsAssignmentReview
                              ? "Review Assignment"
                              : isUnassigned
                                ? "Assign Guards"
                                : "Edit Assignment"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {selectedWorkOrder && (
        <AssignGuardsDialog
          workOrder={selectedWorkOrder}
          isOpen={!!selectedWorkOrder}
          onClose={() => {setSelectedWorkOrder(null);reload();}}
          availableGuards={availableGuards}
          isLoadingGuards={isLoadingGuards}
        />
      )}
    </>
  );
}
