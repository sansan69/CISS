"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { useAppAuth } from "@/context/auth-context";
import { Plus } from "lucide-react";

type TrainingAssignment = {
  id: string;
  employeeId: string;
  employeeName: string;
  clientName?: string;
  district?: string;
  moduleId: string;
  moduleName: string;
  status: string;
  assignedAt?: { seconds: number };
  dueDate?: { seconds: number };
};

type TrainingModuleOption = {
  id: string;
  title: string;
  category?: string;
};

type EmployeeOption = {
  id: string;
  fullName?: string;
  employeeId?: string;
  clientName?: string;
  district?: string;
};

function formatTs(ts?: { seconds: number }) {
  if (!ts?.seconds) return "—";
  return new Date(ts.seconds * 1000).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function TrainingAssignmentsPage() {
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assignments, setAssignments] = useState<TrainingAssignment[]>([]);
  const [modules, setModules] = useState<TrainingModuleOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const isPrivileged = userRole === "admin" || userRole === "superAdmin";

  const loadAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const [assignmentsRes, modulesRes, employeesSnap] = await Promise.all([
        authorizedFetch("/api/admin/training/assignments"),
        authorizedFetch("/api/admin/training/modules"),
        getDocs(query(collection(db, "employees"), limit(200))),
      ]);

      const [assignmentsData, modulesData] = await Promise.all([
        assignmentsRes.json(),
        modulesRes.json(),
      ]);

      if (!assignmentsRes.ok) throw new Error(assignmentsData.error || "Could not load assignments.");
      if (!modulesRes.ok) throw new Error(modulesData.error || "Could not load modules.");

      setAssignments(assignmentsData.assignments ?? []);
      setModules((modulesData.modules ?? []).map((item: any) => ({
        id: item.id,
        title: item.title,
        category: item.category,
      })));
      setEmployees(
        employeesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) })) as EmployeeOption[],
      );
    } catch (error: any) {
      toast({
        title: "Could not load training assignments",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isPrivileged) {
      void loadAssignments();
    }
  }, [isPrivileged, loadAssignments]);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId),
    [employees, selectedEmployeeId],
  );
  const selectedModule = useMemo(
    () => modules.find((module) => module.id === selectedModuleId),
    [modules, selectedModuleId],
  );

  const handleAssign = async () => {
    if (!selectedEmployee || !selectedModule) {
      toast({
        title: "Choose employee and module",
        description: "Both selections are required.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const res = await authorizedFetch("/api/admin/training/assignments", {
        method: "POST",
        body: JSON.stringify({
          employeeId: selectedEmployee.id,
          employeeName: selectedEmployee.fullName ?? selectedEmployee.employeeId ?? "Guard",
          clientName: selectedEmployee.clientName ?? "",
          district: selectedEmployee.district ?? "",
          moduleId: selectedModule.id,
          moduleName: selectedModule.title,
          moduleCategory: selectedModule.category ?? "skills",
          dueDate: dueDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not assign module.");
      toast({ title: "Training assigned" });
      setDialogOpen(false);
      setSelectedEmployeeId("");
      setSelectedModuleId("");
      setDueDate("");
      await loadAssignments();
    } catch (error: any) {
      toast({
        title: "Assignment failed",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!isPrivileged) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Training Assignments" backHref="/training" />
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Admin access required.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Training Assignments"
        backHref="/training"
        description="Assign modules to guards and track their progress."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Assign Module
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : assignments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No training assignments yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {assignments.map((assignment) => (
            <Card key={assignment.id}>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">{assignment.employeeName || assignment.employeeId}</p>
                  <p className="text-xs text-muted-foreground">
                    {assignment.moduleName} · {assignment.clientName || "No client"}{assignment.district ? ` · ${assignment.district}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Assigned {formatTs(assignment.assignedAt)} · Due {formatTs(assignment.dueDate)}
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium capitalize">
                  {assignment.status}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Training Module</DialogTitle>
            <DialogDescription>Choose a guard and a training module for them.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.fullName || employee.employeeId || employee.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Training Module</Label>
              <Select value={selectedModuleId} onValueChange={setSelectedModuleId}>
                <SelectTrigger><SelectValue placeholder="Select module" /></SelectTrigger>
                <SelectContent>
                  {modules.map((module) => (
                    <SelectItem key={module.id} value={module.id}>
                      {module.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <Button className="w-full" disabled={saving} onClick={handleAssign}>
              {saving ? "Assigning..." : "Assign Module"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
