"use client";

import React, { useState, useEffect, useCallback } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, BookOpen, Clock, Target, Pencil, Trash2, GraduationCap, Shield, Scale, Users, Zap } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { TrainingModule, TrainingCategory } from "@/types/training";

const CATEGORY_CONFIG: Record<TrainingCategory, { label: string; icon: React.ElementType; color: string }> = {
  safety: { label: "Safety", icon: Shield, color: "bg-red-100 text-red-700" },
  legal: { label: "Legal", icon: Scale, color: "bg-purple-100 text-purple-700" },
  conduct: { label: "Conduct", icon: Users, color: "bg-blue-100 text-blue-700" },
  skills: { label: "Skills", icon: GraduationCap, color: "bg-green-100 text-green-700" },
  emergency: { label: "Emergency", icon: Zap, color: "bg-amber-100 text-amber-700" },
};

export default function TrainingPage() {
  const { toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<TrainingModule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrainingModule | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "safety" as TrainingCategory,
    durationMinutes: 60,
    passingScore: 70,
    contentUrl: "",
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) setToken(await user.getIdToken());
    });
    return () => unsub();
  }, []);

  const fetchModules = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/training/modules", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setModules(data.modules ?? []);
    } catch {
      toast({ title: "Failed to load training modules", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [token, toast]);

  useEffect(() => { fetchModules(); }, [fetchModules]);

  const openCreate = () => {
    setEditingModule(null);
    setForm({ title: "", description: "", category: "safety", durationMinutes: 60, passingScore: 70, contentUrl: "" });
    setDialogOpen(true);
  };

  const openEdit = (mod: TrainingModule) => {
    setEditingModule(mod);
    setForm({
      title: mod.title,
      description: mod.description,
      category: mod.category,
      durationMinutes: mod.durationMinutes,
      passingScore: mod.passingScore,
      contentUrl: mod.contentUrl ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !token) return;
    setSaving(true);
    try {
      const url = editingModule
        ? `/api/admin/training/modules/${editingModule.id}`
        : "/api/admin/training/modules";
      const method = editingModule ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast({ title: editingModule ? "Module updated" : "Module created" });
      setDialogOpen(false);
      fetchModules();
    } catch {
      toast({ title: "Failed to save module", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !token) return;
    try {
      const res = await fetch(`/api/admin/training/modules/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      toast({ title: "Module deleted" });
      setDeleteTarget(null);
      fetchModules();
    } catch {
      toast({ title: "Failed to delete module", variant: "destructive" });
    }
  };

  const activeModules = modules.filter((m) => m.isActive);
  const inactiveModules = modules.filter((m) => !m.isActive);

  return (
    <div>
      <PageHeader
        title="Training Modules"
        description="Manage training content assigned to security guards"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Training" }]}
        actions={
          <Button onClick={openCreate} className="bg-brand-blue hover:bg-brand-blue-dark text-white gap-2">
            <Plus className="h-4 w-4" />
            New Module
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-8 w-8 animate-spin text-brand-blue" />
        </div>
      ) : modules.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground" />
            <div>
              <p className="font-semibold text-lg">No training modules yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create the first module to start assigning training to guards.</p>
            </div>
            <Button onClick={openCreate} className="bg-brand-blue hover:bg-brand-blue-dark text-white mt-2 gap-2">
              <Plus className="h-4 w-4" /> Create Module
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Active Modules */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Active ({activeModules.length})
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeModules.map((mod) => (
                <ModuleCard key={mod.id} module={mod} onEdit={openEdit} onDelete={setDeleteTarget} />
              ))}
            </div>
          </div>
          {/* Inactive */}
          {inactiveModules.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Inactive ({inactiveModules.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {inactiveModules.map((mod) => (
                  <ModuleCard key={mod.id} module={mod} onEdit={openEdit} onDelete={setDeleteTarget} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingModule ? "Edit Module" : "New Training Module"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Fire Safety Basics"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What will guards learn?"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v as TrainingCategory }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                      <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="duration">Duration (mins)</Label>
                <Input
                  id="duration"
                  type="number"
                  min={5}
                  value={form.durationMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, durationMinutes: parseInt(e.target.value) || 60 }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="passing">Passing Score (%)</Label>
              <Input
                id="passing"
                type="number"
                min={0}
                max={100}
                value={form.passingScore}
                onChange={(e) => setForm((f) => ({ ...f, passingScore: parseInt(e.target.value) || 70 }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contentUrl">Content URL (optional)</Label>
              <Input
                id="contentUrl"
                value={form.contentUrl}
                onChange={(e) => setForm((f) => ({ ...f, contentUrl: e.target.value }))}
                placeholder="https://... PDF or video link"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={!form.title.trim() || saving}
              className="bg-brand-blue hover:bg-brand-blue-dark text-white"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingModule ? "Save Changes" : "Create Module"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Training Module?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.title}&quot; will be permanently deleted. Existing assignments will remain but no new ones can be created for this module.
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

function ModuleCard({
  module,
  onEdit,
  onDelete,
}: {
  module: TrainingModule;
  onEdit: (m: TrainingModule) => void;
  onDelete: (m: TrainingModule) => void;
}) {
  const cat = CATEGORY_CONFIG[module.category] ?? CATEGORY_CONFIG.safety;
  const CatIcon = cat.icon;

  return (
    <Card className={`relative ${!module.isActive ? "opacity-60" : ""}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${cat.color}`}>
            <CatIcon className="h-3 w-3" />
            {cat.label}
          </div>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(module)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(module)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <CardTitle className="text-base mt-2 leading-snug">{module.title}</CardTitle>
        {module.description && (
          <CardDescription className="text-xs line-clamp-2">{module.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {module.durationMinutes} min
          </span>
          <span className="flex items-center gap-1">
            <Target className="h-3 w-3" />
            Pass: {module.passingScore}%
          </span>
        </div>
        {!module.isActive && (
          <Badge variant="secondary" className="mt-2 text-xs">Inactive</Badge>
        )}
      </CardContent>
    </Card>
  );
}
