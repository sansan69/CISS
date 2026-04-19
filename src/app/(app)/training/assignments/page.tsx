"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query } from "firebase/firestore";
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
  clientId?: string;
  clientName?: string;
  district?: string;
  status?: string;
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
  const { userRole, assignedDistricts } = useAppAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assignments, setAssignments] = useState<TrainingAssignment[]>([]);
  const [modules, setModules] = useState<TrainingModuleOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [filterClient, setFilterClient] = useState<string>("all");
  const [filterDistrict, setFilterDistrict] = useState<string>("all");
  const [dueDate, setDueDate] = useState("");
  const isAdmin = userRole === "admin" || userRole === "superAdmin";
  const isFieldOfficer = userRole === "fieldOfficer";
  const isPrivileged = isAdmin || isFieldOfficer;
  const foDistricts = useMemo(() => (isFieldOfficer ? assignedDistricts || [] : []), [assignedDistricts, isFieldOfficer]);

  const loadAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const [assignmentsRes, modulesRes, employeesSnap] = await Promise.all([
        authorizedFetch("/api/admin/training/assignments"),
        authorizedFetch("/api/admin/training/modules"),
        getDocs(query(collection(db, "employees"))),
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

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach((e) => {
      if (e.clientName) map.set(e.clientId || e.clientName, e.clientName);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [employees]);

  const districtOptions = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => {
      if (!e.district) return;
      if (isFieldOfficer && !foDistricts.includes(e.district)) return;
      if (filterClient !== "all") {
        const matchesId = e.clientId === filterClient;
        const matchesName = e.clientName === filterClient;
        if (!matchesId && !matchesName) return;
      }
      set.add(e.district);
    });
    return Array.from(set).sort();
  }, [employees, filterClient, isFieldOfficer, foDistricts]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      if (isFieldOfficer) {
        if (!e.district || !foDistricts.includes(e.district)) return false;
      }
      if (filterClient !== "all") {
        const matchesId = e.clientId === filterClient;
        const matchesName = e.clientName === filterClient;
        if (!matchesId && !matchesName) return false;
      }
      if (filterDistrict !== "all" && e.district !== filterDistrict) return false;
      return true;
    });
  }, [employees, filterClient, filterDistrict, isFieldOfficer, foDistricts]);

  useEffect(() => {
    if (selectedEmployeeId && !filteredEmployees.find((e) => e.id === selectedEmployeeId)) {
      setSelectedEmployeeId("");
    }
  }, [filteredEmployees, selectedEmployeeId]);

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
          clientId: selectedEmployee.clientId ?? "",
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
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Client</Label>
                <Select value={filterClient} onValueChange={(v) => { setFilterClient(v); setFilterDistrict("all"); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All clients</SelectItem>
                    {clientOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>District</Label>
                <Select value={filterDistrict} onValueChange={setFilterDistrict}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All districts</SelectItem>
                    {districtOptions.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Employee ({filteredEmployees.length})</Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger><SelectValue placeholder={filteredEmployees.length ? "Select employee" : "No employees match filters"} /></SelectTrigger>
                <SelectContent>
                  {filteredEmployees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {(employee.fullName || employee.employeeId || employee.id)}
                      {employee.district ? ` · ${employee.district}` : ""}
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
