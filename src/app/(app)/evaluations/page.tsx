"use client";

import React, { useState, useEffect, useCallback } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Star, User, Calendar, ClipboardList, ChevronRight } from "lucide-react";
import { format, subDays } from "date-fns";
import { resolveAppUser } from "@/lib/auth/roles";
import type { User as FirebaseUser } from "firebase/auth";
import type { Evaluation } from "@/types/evaluation";
import type { Employee } from "@/types/employee";

const CURRENT_PERIOD = format(new Date(), "yyyy-MM");

interface CriteriaField { key: keyof Evaluation["criteria"]; label: string; helpText: string }
const CRITERIA_FIELDS: CriteriaField[] = [
  { key: "punctuality", label: "Punctuality", helpText: "Timely reporting, attendance regularity" },
  { key: "uniformCompliance", label: "Uniform Compliance", helpText: "Auto-filled from photo records — adjust if needed" },
  { key: "behaviorProfessionalism", label: "Behaviour & Professionalism", helpText: "Conduct with clients and colleagues" },
  { key: "skillCompetency", label: "Skill & Competency", helpText: "Job knowledge, emergency response" },
  { key: "clientFeedback", label: "Client Feedback", helpText: "Feedback received from client site" },
];

export default function EvaluationsPage() {
  const { toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [periodFilter, setPeriodFilter] = useState(CURRENT_PERIOD);

  // Employee search for new evaluation
  const [empSearch, setEmpSearch] = useState("");
  const [empResults, setEmpResults] = useState<Employee[]>([]);
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [searchingEmp, setSearchingEmp] = useState(false);
  const [criteria, setCriteria] = useState<Record<string, number>>({
    punctuality: 7, uniformCompliance: 7, behaviorProfessionalism: 7, skillCompetency: 7, clientFeedback: 7,
  });
  const [comments, setComments] = useState("");
  const [autoComplianceRate, setAutoComplianceRate] = useState<number | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setAuthUser(user);
        setToken(await user.getIdToken());
        try {
          const appUser = await resolveAppUser(user);
          setUserRole(appUser.role);
        } catch { setUserRole("user"); }
      }
    });
    return () => unsub();
  }, []);

  const fetchEvaluations = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/evaluations?period=${periodFilter}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setEvaluations(data.evaluations ?? []);
    } catch {
      toast({ title: "Failed to load evaluations", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [token, periodFilter, toast]);

  useEffect(() => { fetchEvaluations(); }, [fetchEvaluations]);

  const searchEmployees = useCallback(async (term: string) => {
    if (!term.trim()) { setEmpResults([]); return; }
    setSearchingEmp(true);
    try {
      const snap = await getDocs(
        query(collection(db, "employees"), where("status", "==", "Active"), limit(10))
      );
      const lower = term.toLowerCase();
      const results = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Employee))
        .filter((e) => e.fullName?.toLowerCase().includes(lower) || e.employeeId?.toLowerCase().includes(lower));
      setEmpResults(results);
    } catch { setEmpResults([]); }
    finally { setSearchingEmp(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchEmployees(empSearch), 400);
    return () => clearTimeout(t);
  }, [empSearch, searchEmployees]);

  const selectEmployee = async (emp: Employee) => {
    setSelectedEmp(emp);
    setEmpResults([]);
    setEmpSearch(emp.fullName ?? "");

    // Auto-fetch uniform compliance from last 30 days
    try {
      const since = subDays(new Date(), 30);
      const snap = await getDocs(
        query(
          collection(db, "attendanceLogs"),
          where("employeeDocId", "==", emp.id),
          where("createdAt", ">=", since),
          limit(100)
        )
      );
      const logs = snap.docs.map((d) => d.data());
      if (logs.length > 0) {
        const clearCount = logs.filter((l) => l.photoCompliance?.overallStatus === "clear").length;
        const rate = clearCount / logs.length;
        setAutoComplianceRate(rate);
        setCriteria((c) => ({ ...c, uniformCompliance: Math.round(rate * 10) }));
      }
    } catch { /* non-critical */ }
  };

  const handleSubmit = async () => {
    if (!selectedEmp || !token) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/evaluations", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: selectedEmp.id,
          employeeName: selectedEmp.fullName,
          employeeCode: selectedEmp.employeeId,
          clientId: (selectedEmp as any).clientId ?? "",
          clientName: selectedEmp.clientName,
          district: selectedEmp.district,
          period: periodFilter,
          evaluatedByName: authUser?.email ?? "",
          criteria,
          comments,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast({ title: `Evaluation saved — Score: ${data.normalizedScore}/100` });
      setDialogOpen(false);
      setSelectedEmp(null);
      setEmpSearch("");
      setComments("");
      setCriteria({ punctuality: 7, uniformCompliance: 7, behaviorProfessionalism: 7, skillCompetency: 7, clientFeedback: 7 });
      fetchEvaluations();
    } catch {
      toast({ title: "Failed to save evaluation", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const totalScore = Object.values(criteria).reduce((s, v) => s + v, 0);
  const normalizedScore = Math.round((totalScore / 50) * 100);

  // Generate last 6 months for filter
  const periodOptions = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return format(d, "yyyy-MM");
  });

  return (
    <div>
      <PageHeader
        title="Evaluations"
        description="Rate guard performance on punctuality, uniform, behaviour, skill, and client feedback"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Evaluations" }]}
        actions={
          <Button onClick={() => setDialogOpen(true)} className="bg-brand-blue hover:bg-brand-blue-dark text-white gap-2">
            <Plus className="h-4 w-4" />
            New Evaluation
          </Button>
        }
      />

      {/* Period Filter */}
      <div className="flex items-center gap-3 mb-6">
        <Label className="text-sm text-muted-foreground shrink-0">Period:</Label>
        <Select value={periodFilter} onValueChange={setPeriodFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periodOptions.map((p) => (
              <SelectItem key={p} value={p}>{format(new Date(p + "-01"), "MMMM yyyy")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{evaluations.length} evaluations</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-8 w-8 animate-spin text-brand-blue" />
        </div>
      ) : evaluations.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <ClipboardList className="h-12 w-12 text-muted-foreground" />
            <div>
              <p className="font-semibold text-lg">No evaluations for {format(new Date(periodFilter + "-01"), "MMMM yyyy")}</p>
              <p className="text-sm text-muted-foreground mt-1">Start evaluating guards to build their performance scores.</p>
            </div>
            <Button onClick={() => setDialogOpen(true)} className="bg-brand-blue hover:bg-brand-blue-dark text-white mt-2 gap-2">
              <Plus className="h-4 w-4" /> Evaluate a Guard
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {evaluations.map((ev) => (
            <EvaluationRow key={ev.id} evaluation={ev} />
          ))}
        </div>
      )}

      {/* New Evaluation Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) { setSelectedEmp(null); setEmpSearch(""); } setDialogOpen(v); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Evaluation</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Employee search */}
            <div className="space-y-1.5">
              <Label>Guard *</Label>
              <div className="relative">
                <Input
                  placeholder="Search by name or ID..."
                  value={empSearch}
                  onChange={(e) => { setEmpSearch(e.target.value); setSelectedEmp(null); }}
                />
                {searchingEmp && (
                  <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {empResults.length > 0 && !selectedEmp && (
                <div className="border rounded-md bg-white shadow-md divide-y max-h-40 overflow-y-auto">
                  {empResults.map((emp) => (
                    <button
                      key={emp.id}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted text-left text-sm"
                      onClick={() => selectEmployee(emp)}
                    >
                      <User className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="font-medium">{emp.fullName}</p>
                        <p className="text-xs text-muted-foreground">{emp.employeeId} · {emp.clientName}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selectedEmp && (
                <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-md text-sm">
                  <User className="h-4 w-4 text-green-700 shrink-0" />
                  <span className="font-medium text-green-700">{selectedEmp.fullName}</span>
                  <span className="text-green-600">· {selectedEmp.clientName}</span>
                  {autoComplianceRate !== null && (
                    <Badge variant="secondary" className="ml-auto text-xs">
                      Uniform: {Math.round(autoComplianceRate * 100)}%
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {/* Score Summary */}
            <div className="flex items-center justify-between p-3 bg-brand-blue/5 rounded-lg border border-brand-blue/20">
              <span className="text-sm font-medium text-brand-blue">Total Score</span>
              <div className="text-right">
                <span className="text-2xl font-bold text-brand-blue">{normalizedScore}</span>
                <span className="text-sm text-muted-foreground">/100</span>
              </div>
            </div>

            {/* Criteria */}
            {CRITERIA_FIELDS.map(({ key, label, helpText }) => (
              <div key={key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">{label}</Label>
                  <span className="text-sm font-bold text-brand-blue w-8 text-right">{criteria[key]}/10</span>
                </div>
                <p className="text-xs text-muted-foreground -mt-1">{helpText}</p>
                <Slider
                  value={[criteria[key]]}
                  onValueChange={([v]) => setCriteria((c) => ({ ...c, [key]: v }))}
                  min={0}
                  max={10}
                  step={1}
                  className="w-full"
                />
              </div>
            ))}

            {/* Comments */}
            <div className="space-y-1.5">
              <Label>Comments (optional)</Label>
              <Textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Any observations or feedback..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!selectedEmp || saving}
              className="bg-brand-blue hover:bg-brand-blue-dark text-white"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save Evaluation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EvaluationRow({ evaluation }: { evaluation: Evaluation }) {
  const score = evaluation.normalizedScore;
  const scoreColor = score >= 80 ? "text-green-600" : score >= 60 ? "text-amber-600" : "text-red-600";
  const scoreBg = score >= 80 ? "bg-green-50 border-green-200" : score >= 60 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl border shrink-0 ${scoreBg}`}>
            <span className={`text-xl font-bold ${scoreColor}`}>{score}</span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-sm">{evaluation.employeeName}</p>
                <p className="text-xs text-muted-foreground">{evaluation.employeeCode} · {evaluation.clientName} · {evaluation.district}</p>
              </div>
              <div className="text-right text-xs text-muted-foreground shrink-0">
                <p className="flex items-center gap-1 justify-end"><Calendar className="h-3 w-3" />{evaluation.period}</p>
                <p className="mt-0.5">by {evaluation.evaluatedByName}</p>
              </div>
            </div>
            {/* Criteria mini bars */}
            <div className="mt-3 grid grid-cols-5 gap-1">
              {Object.entries(evaluation.criteria).map(([key, val]) => (
                <div key={key} className="flex flex-col items-center gap-0.5">
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-brand-blue rounded-full" style={{ width: `${(val / 10) * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{val}</span>
                </div>
              ))}
            </div>
            {evaluation.comments && (
              <p className="mt-2 text-xs text-muted-foreground italic line-clamp-1">&quot;{evaluation.comments}&quot;</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
