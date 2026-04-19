"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Plus, Library, ArrowRight, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type Bank = {
  id: string;
  title: string;
  moduleId: string;
  questionCount?: number;
  questionsPerAttempt?: number;
  timeLimitMinutes?: number;
};
type ModuleOpt = { id: string; title: string };

export default function QuestionBanksPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [modules, setModules] = useState<ModuleOpt[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Bank | null>(null);
  const [form, setForm] = useState({
    title: "",
    moduleId: "",
    questionsPerAttempt: 10,
    timeLimitMinutes: 0,
    shuffle: true,
    maxAttempts: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [banksRes, modsRes] = await Promise.all([
        authorizedFetch("/api/admin/training/banks"),
        authorizedFetch("/api/admin/training/modules"),
      ]);
      const banksData = await banksRes.json();
      const modsData = await modsRes.json();
      if (!banksRes.ok) throw new Error(banksData.error || "Failed to load banks");
      setBanks(banksData.banks ?? []);
      setModules((modsData.modules ?? []).map((m: any) => ({ id: m.id, title: m.title })));
    } catch (err: any) {
      toast({ title: "Could not load question banks", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const moduleTitle = (id: string) => modules.find((m) => m.id === id)?.title || "Unassigned";

  const openCreate = () => {
    setForm({ title: "", moduleId: "", questionsPerAttempt: 10, timeLimitMinutes: 0, shuffle: true, maxAttempts: 0 });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.moduleId) {
      toast({ title: "Title and module required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await authorizedFetch("/api/admin/training/banks", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create bank");
      toast({ title: "Bank created" });
      setDialogOpen(false);
      await load();
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await authorizedFetch(`/api/admin/training/banks/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ title: "Bank deleted" });
      setDeleteTarget(null);
      await load();
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  return (
    <div>
      <PageHeader
        title="Question Banks"
        description="Create question banks tied to modules; guards get random quizzes from here."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Training", href: "/training" },
          { label: "Question Banks" },
        ]}
        actions={
          <Button onClick={openCreate} className="gap-2 bg-brand-blue text-white hover:bg-brand-blue-dark">
            <Plus className="h-4 w-4" />
            New Bank
          </Button>
        }
      />
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : banks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Library className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No question banks yet</p>
            <Button onClick={openCreate} variant="secondary">Create first bank</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {banks.map((b) => (
            <Card key={b.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{b.title}</CardTitle>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(b)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <CardDescription className="text-xs">Module: {moduleTitle(b.moduleId)}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{b.questionCount ?? 0} questions</span>
                  <span>Pull {b.questionsPerAttempt ?? 10}/attempt</span>
                </div>
                <Link href={`/training/banks/${b.id}`} className="mt-3 inline-flex items-center text-sm font-medium text-brand-blue">
                  Manage questions <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Question Bank</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Fire Safety Quiz" />
            </div>
            <div className="space-y-1.5">
              <Label>Module *</Label>
              <Select value={form.moduleId} onValueChange={(v) => setForm((f) => ({ ...f, moduleId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select module" /></SelectTrigger>
                <SelectContent>
                  {modules.map((m) => <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Questions / attempt</Label>
                <Input type="number" min={1} value={form.questionsPerAttempt} onChange={(e) => setForm((f) => ({ ...f, questionsPerAttempt: parseInt(e.target.value) || 10 }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Time limit (min)</Label>
                <Input type="number" min={0} value={form.timeLimitMinutes} onChange={(e) => setForm((f) => ({ ...f, timeLimitMinutes: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Max attempts (0 = unlimited)</Label>
                <Input type="number" min={0} value={form.maxAttempts} onChange={(e) => setForm((f) => ({ ...f, maxAttempts: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Shuffle</Label>
                <Select value={form.shuffle ? "yes" : "no"} onValueChange={(v) => setForm((f) => ({ ...f, shuffle: v === "yes" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-brand-blue text-white hover:bg-brand-blue-dark">
              {saving ? "Creating..." : "Create Bank"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete bank?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.title}&quot; and all its questions will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
