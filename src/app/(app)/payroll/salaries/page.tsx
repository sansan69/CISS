"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Pencil, IndianRupee, Wallet } from "lucide-react";
import type { EmployeeSalary, SalaryStructure } from "@/types/payroll";

interface Client {
  id: string;
  name: string;
}

interface EmployeeRow {
  id: string;
  name: string;
  employeeCode: string;
  clientId: string;
  clientName: string;
  district: string;
}

export default function PayrollSalariesPage() {
  const router = useRouter();
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [assignments, setAssignments] = useState<Record<string, EmployeeSalary>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null);
  const [selectedStructureId, setSelectedStructureId] = useState("");
  const [grossMonthly, setGrossMonthly] = useState("");
  const [taxRegime, setTaxRegime] = useState<"new" | "old">("new");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (userRole !== null && userRole !== "admin" && userRole !== "superAdmin") {
      router.replace("/dashboard");
    }
  }, [userRole, router]);

  useEffect(() => {
    authorizedFetch("/api/admin/clients")
      .then((res) => res.json())
      .then((data) => setClients(data.clients ?? []))
      .catch(() => {});
  }, []);

  const loadData = useCallback(async (clientId: string) => {
    setIsLoading(true);
    try {
      const [employeeRes, structureRes, assignmentRes] = await Promise.all([
        authorizedFetch(`/api/admin/employees?clientId=${clientId}&status=Active&limit=300`),
        authorizedFetch(`/api/admin/salary-structures?clientId=${clientId}`),
        authorizedFetch(`/api/admin/employee-salaries?clientId=${clientId}&limit=300`),
      ]);

      const [employeeData, structureData, assignmentData] = await Promise.all([
        employeeRes.json(),
        structureRes.json(),
        assignmentRes.json(),
      ]);

      setEmployees(employeeData.employees ?? []);
      setStructures(structureData.structures ?? []);
      const mappedAssignments = Object.fromEntries(
        (assignmentData.assignments ?? []).map((assignment: EmployeeSalary) => [assignment.employeeId, assignment]),
      );
      setAssignments(mappedAssignments);
    } catch {
      toast({ title: "Error", description: "Failed to load salary assignment data.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (selectedClientId) {
      void loadData(selectedClientId);
    }
  }, [selectedClientId, loadData]);

  const selectedStructure = useMemo(
    () => structures.find((structure) => structure.id === selectedStructureId) ?? null,
    [structures, selectedStructureId],
  );

  const openAssignment = (employee: EmployeeRow) => {
    const assignment = assignments[employee.id];
    setSelectedEmployee(employee);
    setSelectedStructureId(assignment?.structureId ?? "");
    setGrossMonthly(String(assignment?.grossMonthly ?? ""));
    setTaxRegime(assignment?.taxRegime ?? "new");
    setEffectiveFrom(
      assignment?.effectiveFrom && typeof assignment.effectiveFrom === "object" && "seconds" in assignment.effectiveFrom
        ? new Date((assignment.effectiveFrom as unknown as { seconds: number }).seconds * 1000).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
    );
  };

  const handleSave = async () => {
    if (!selectedEmployee || !selectedStructure) return;
    setIsSaving(true);
    try {
      const res = await authorizedFetch(`/api/admin/employees/${selectedEmployee.id}/salary`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedEmployee.clientId,
          structureId: selectedStructure.id,
          structureName: selectedStructure.name,
          effectiveFrom,
          grossMonthly: Number(grossMonthly || selectedStructure.grossMonthly),
          componentOverrides: {},
          taxRegime,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save salary assignment.");
      toast({ title: "Saved", description: `Salary assigned to ${selectedEmployee.name}.` });
      setSelectedEmployee(null);
      await loadData(selectedClientId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save salary assignment.";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Employee Salary Assignments"
        description="Map active employees to salary grades before running payroll."
        backHref="/payroll"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select Client</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Choose a client..." />
            </SelectTrigger>
            <SelectContent>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedClientId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assignments</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-4">
                {[1, 2, 3].map((row) => (
                  <Skeleton key={row} className="h-16 w-full" />
                ))}
              </div>
            ) : employees.length === 0 ? (
              <div className="py-14 text-center text-sm text-muted-foreground">No active employees found for this client.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">District</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Salary Grade</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Gross</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((employee) => {
                      const assignment = assignments[employee.id];
                      return (
                        <tr key={employee.id} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <div className="font-medium">{employee.name}</div>
                            <div className="text-xs text-muted-foreground">{employee.employeeCode || employee.id}</div>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{employee.district || "—"}</td>
                          <td className="px-4 py-3">{assignment?.structureName || "Not assigned"}</td>
                          <td className="px-4 py-3 text-right">
                            {assignment?.grossMonthly ? `₹${assignment.grossMonthly.toLocaleString("en-IN")}` : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button variant="outline" size="sm" onClick={() => openAssignment(employee)}>
                              <Pencil className="mr-1.5 h-4 w-4" />
                              {assignment ? "Edit" : "Assign"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Sheet open={!!selectedEmployee} onOpenChange={(open) => !open && setSelectedEmployee(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Assign Salary</SheetTitle>
            <SheetDescription>{selectedEmployee?.name}</SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label>Salary Grade</Label>
              <Select
                value={selectedStructureId}
                onValueChange={(value) => {
                  setSelectedStructureId(value);
                  const structure = structures.find((item) => item.id === value);
                  if (structure) setGrossMonthly(String(structure.grossMonthly));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose salary grade..." />
                </SelectTrigger>
                <SelectContent>
                  {structures.map((structure) => (
                    <SelectItem key={structure.id} value={structure.id}>
                      {structure.name} — ₹{structure.grossMonthly.toLocaleString("en-IN")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Gross Monthly ₹</Label>
              <Input type="number" value={grossMonthly} onChange={(event) => setGrossMonthly(event.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tax Regime</Label>
                <Select value={taxRegime} onValueChange={(value) => setTaxRegime(value as "new" | "old")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="old">Old</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Effective From</Label>
                <Input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
              </div>
            </div>

            {selectedStructure && (
              <div className="rounded-xl bg-muted/50 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Grade snapshot</p>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  {selectedStructure.name}
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <IndianRupee className="h-4 w-4" />
                  Monthly gross template: ₹{selectedStructure.grossMonthly.toLocaleString("en-IN")}
                </div>
              </div>
            )}

            <Button className="w-full" onClick={handleSave} disabled={isSaving || !selectedStructureId || !grossMonthly}>
              {isSaving ? "Saving..." : "Save Salary Assignment"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
