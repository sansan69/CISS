"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Plus, Trash2, CheckCircle2, Pencil } from "lucide-react";

type Question = {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
};

type BankDoc = {
  id: string;
  title: string;
  moduleId: string;
  questionCount?: number;
  questionsPerAttempt?: number;
  timeLimitMinutes?: number;
};

export default function BankDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [bank, setBank] = useState<BankDoc | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [form, setForm] = useState({ prompt: "", options: ["", "", "", ""], correctIndex: 0, explanation: "" });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [bankRes, qRes] = await Promise.all([
        authorizedFetch(`/api/admin/training/banks/${id}`),
        authorizedFetch(`/api/admin/training/banks/${id}/questions`),
      ]);
      const bankData = await bankRes.json();
      const qData = await qRes.json();
      if (!bankRes.ok) throw new Error(bankData.error || "Failed");
      setBank(bankData.bank);
      setQuestions(qData.questions ?? []);
    } catch (err: any) {
      toast({ title: "Failed to load bank", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ prompt: "", options: ["", "", "", ""], correctIndex: 0, explanation: "" });
    setDialogOpen(true);
  };

  const openEdit = (q: Question) => {
    setEditing(q);
    setForm({
      prompt: q.prompt,
      options: q.options.length >= 2 ? q.options : [...q.options, "", ""].slice(0, 4),
      correctIndex: q.correctIndex,
      explanation: q.explanation ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const options = form.options.map((o) => o.trim()).filter(Boolean);
    if (!form.prompt.trim() || options.length < 2) {
      toast({ title: "Prompt + at least 2 options required", variant: "destructive" });
      return;
    }
    const correctIndex = Math.min(form.correctIndex, options.length - 1);
    setSaving(true);
    try {
      const url = editing
        ? `/api/admin/training/banks/${id}/questions/${editing.id}`
        : `/api/admin/training/banks/${id}/questions`;
      const method = editing ? "PATCH" : "POST";
      const res = await authorizedFetch(url, {
        method,
        body: JSON.stringify({ prompt: form.prompt.trim(), options, correctIndex, explanation: form.explanation.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast({ title: editing ? "Question updated" : "Question added" });
      setDialogOpen(false);
      await load();
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (qid: string) => {
    try {
      const res = await authorizedFetch(`/api/admin/training/banks/${id}/questions/${qid}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ title: "Question deleted" });
      await load();
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  return (
    <div>
      <PageHeader
        title={bank?.title || "Question Bank"}
        description={`${questions.length} questions · pull ${bank?.questionsPerAttempt ?? 10} per attempt${bank?.timeLimitMinutes ? ` · ${bank.timeLimitMinutes} min` : ""}`}
        backHref="/training/banks"
        actions={
          <Button onClick={openCreate} className="gap-2 bg-brand-blue text-white hover:bg-brand-blue-dark">
            <Plus className="h-4 w-4" /> Add Question
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : questions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No questions yet. Add your first one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {questions.map((q, idx) => (
            <Card key={q.id}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{idx + 1}. {q.prompt}</p>
                  <ul className="mt-2 space-y-1 text-xs">
                    {q.options.map((opt, i) => (
                      <li key={i} className={`flex items-center gap-1.5 ${i === q.correctIndex ? "font-medium text-green-700" : "text-muted-foreground"}`}>
                        {i === q.correctIndex && <CheckCircle2 className="h-3.5 w-3.5" />}
                        <span>{String.fromCharCode(65 + i)}. {opt}</span>
                      </li>
                    ))}
                  </ul>
                  {q.explanation && <p className="mt-2 text-xs italic text-muted-foreground">{q.explanation}</p>}
                </div>
                <div className="flex flex-col gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(q)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(q.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Question" : "Add Question"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Prompt</Label>
              <Textarea rows={2} value={form.prompt} onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))} />
            </div>
            {form.options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="correct"
                  checked={form.correctIndex === i}
                  onChange={() => setForm((f) => ({ ...f, correctIndex: i }))}
                />
                <Input
                  placeholder={`Option ${String.fromCharCode(65 + i)}`}
                  value={opt}
                  onChange={(e) => setForm((f) => {
                    const next = [...f.options];
                    next[i] = e.target.value;
                    return { ...f, options: next };
                  })}
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label>Explanation (optional)</Label>
              <Textarea rows={2} value={form.explanation} onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-brand-blue text-white hover:bg-brand-blue-dark">
              {saving ? "Saving..." : editing ? "Save Changes" : "Add Question"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
