"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { auth, storage } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, BookOpen, Clock, Target, Pencil, Trash2, GraduationCap, Shield, Scale, Users, Zap, UploadCloud, FileText, FileImage, Presentation } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { TrainingModule, TrainingCategory, TrainingContentType } from "@/types/training";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ACCEPTED_MIME: Record<string, TrainingContentType> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/jpg": "image",
};
const ACCEPT_ATTR = ".pdf,.pptx,.jpg,.jpeg,.png,.webp,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/*";

function resolveContentType(file: File): TrainingContentType | null {
  if (ACCEPTED_MIME[file.type]) return ACCEPTED_MIME[file.type];
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".pptx")) return "pptx";
  if (/\.(jpe?g|png|webp)$/.test(name)) return "image";
  return null;
}

function contentIcon(type?: TrainingContentType) {
  if (type === "pdf") return FileText;
  if (type === "pptx") return Presentation;
  if (type === "image") return FileImage;
  return BookOpen;
}

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "safety" as TrainingCategory,
    durationMinutes: 60,
    passingScore: 70,
    contentUrl: "",
    contentType: null as TrainingContentType | null,
    contentPath: "",
    contentFileName: "",
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

  const resetFilePicker = () => {
    setPendingFile(null);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openCreate = () => {
    setEditingModule(null);
    setForm({ title: "", description: "", category: "safety", durationMinutes: 60, passingScore: 70, contentUrl: "", contentType: null, contentPath: "", contentFileName: "" });
    resetFilePicker();
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
      contentType: mod.contentType ?? null,
      contentPath: mod.contentPath ?? "",
      contentFileName: mod.contentFileName ?? "",
    });
    resetFilePicker();
    setDialogOpen(true);
  };

  const handleFilePick = (file: File | null) => {
    if (!file) {
      resetFilePicker();
      return;
    }
    const type = resolveContentType(file);
    if (!type) {
      toast({ title: "Unsupported file type", description: "Upload .pdf, .pptx, .jpg, .png, or .webp.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({ title: "File too large", description: "Maximum upload size is 100 MB.", variant: "destructive" });
      return;
    }
    setPendingFile(file);
    setUploadProgress(null);
  };

  const uploadPendingFile = async (): Promise<{ url: string; path: string; type: TrainingContentType; name: string } | null> => {
    if (!pendingFile) return null;
    const type = resolveContentType(pendingFile)!;
    const safeName = pendingFile.name.replace(/[^a-zA-Z0-9_.\-]/g, "_");
    const path = `trainingModules/${Date.now()}_${safeName}`;
    const objectRef = storageRef(storage, path);
    const task = uploadBytesResumable(objectRef, pendingFile, { contentType: pendingFile.type });
    setUploadProgress(0);
    await new Promise<void>((resolve, reject) => {
      task.on(
        "state_changed",
        (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
        (err) => reject(err),
        () => resolve(),
      );
    });
    const url = await getDownloadURL(task.snapshot.ref);
    return { url, path, type, name: pendingFile.name };
  };

  const handleSave = async () => {
    if (!form.title.trim() || !token) return;
    setSaving(true);
    try {
      let payload: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        category: form.category,
        durationMinutes: form.durationMinutes,
        passingScore: form.passingScore,
        contentUrl: form.contentUrl || null,
        contentType: form.contentType,
        contentPath: form.contentPath || null,
        contentFileName: form.contentFileName || null,
      };

      if (pendingFile) {
        const uploaded = await uploadPendingFile();
        if (uploaded) {
          payload = {
            ...payload,
            contentUrl: uploaded.url,
            contentType: uploaded.type,
            contentPath: uploaded.path,
            contentFileName: uploaded.name,
          };
        }
      }

      const url = editingModule
        ? `/api/admin/training/modules/${editingModule.id}`
        : "/api/admin/training/modules";
      const method = editingModule ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      toast({ title: editingModule ? "Module updated" : "Module created" });
      setDialogOpen(false);
      resetFilePicker();
      fetchModules();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Failed to save module", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
      setUploadProgress(null);
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
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <a href="/training/banks">Question Banks</a>
            </Button>
            <Button onClick={openCreate} className="bg-brand-blue hover:bg-brand-blue-dark text-white gap-2">
              <Plus className="h-4 w-4" />
              New Module
            </Button>
          </div>
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
              <Label>Module File</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_ATTR}
                className="hidden"
                onChange={(e) => handleFilePick(e.target.files?.[0] ?? null)}
              />
              <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
                {pendingFile ? (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{pendingFile.name}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => handleFilePick(null)}>Remove</Button>
                  </div>
                ) : form.contentFileName ? (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">Current: {form.contentFileName}</span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No file attached yet.</p>
                )}
                <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={() => fileInputRef.current?.click()}>
                  <UploadCloud className="h-4 w-4" />
                  {form.contentFileName || pendingFile ? "Replace file" : "Upload file"}
                </Button>
                <p className="text-[11px] text-muted-foreground">PDF, PPTX, or image (JPG/PNG/WEBP). Max 100 MB.</p>
                {uploadProgress !== null && (
                  <div className="space-y-1">
                    <Progress value={uploadProgress} />
                    <p className="text-[11px] text-muted-foreground">Uploading… {uploadProgress}%</p>
                  </div>
                )}
              </div>
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
