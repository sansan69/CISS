"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  SpinnerGap as Loader2,
  UploadSimple as Upload,
} from "@phosphor-icons/react";

import { authorizedFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type UploadedRow = {
  id: string;
  fileName: string;
  employeeId: string;
  employeeName: string;
  period: string;
};

type UnmatchedRow = { fileName: string; reason: string };

const currentPeriod = () => new Date().toISOString().slice(0, 7);

export default function PayslipsAdminPage() {
  const { toast } = useToast();
  const [period, setPeriod] = useState(currentPeriod());
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedRow[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [errors, setErrors] = useState<Array<{ fileName: string; message: string }>>([]);
  const [recent, setRecent] = useState<UploadedRow[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);

  const fileSummary = useMemo(
    () => files.map((file) => `${file.name} (${Math.round(file.size / 1024)} KB)`).join(", "),
    [files],
  );

  const loadRecent = useCallback(async () => {
    setIsLoadingRecent(true);
    try {
      const response = await authorizedFetch(`/api/admin/payslips?period=${encodeURIComponent(period)}`);
      const body = await response.json().catch(() => ({}));
      if (response.ok) setRecent(body.payslips ?? []);
    } finally {
      setIsLoadingRecent(false);
    }
  }, [period]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const upload = async () => {
    if (files.length === 0) {
      toast({ title: "Choose payslip PDFs first", variant: "destructive" });
      return;
    }
    const form = new FormData();
    form.set("period", period);
    for (const file of files) form.append("files", file);

    setIsUploading(true);
    setUploaded([]);
    setUnmatched([]);
    setErrors([]);
    try {
      const response = await authorizedFetch("/api/admin/payslips/upload", {
        method: "POST",
        body: form,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Upload failed.");
      setUploaded(body.uploaded ?? []);
      setUnmatched(body.unmatched ?? []);
      setErrors(body.errors ?? []);
      toast({
        title: "Payslips processed",
        description: `${(body.uploaded ?? []).length} saved, ${(body.unmatched ?? []).length} need attention.`,
      });
      setFiles([]);
      await loadRecent();
    } catch (error: any) {
      toast({ title: "Upload failed", description: error?.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Payslips</h1>
        <p className="text-sm text-muted-foreground">
          Upload payslip PDFs in bulk. The employee ID (or a unique employee name) is read from
          each PDF; matched slips are stored per guard and appear in their web and Android portal.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" /> Bulk upload
          </CardTitle>
          <CardDescription>PDF only, up to 50 files per batch, 10 MB each.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="period">Pay period</Label>
              <Input
                id="period"
                type="month"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="files">PDF files</Label>
              <Input
                id="files"
                type="file"
                accept="application/pdf"
                multiple
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </div>
          </div>
          {files.length > 0 && (
            <p className="text-xs text-muted-foreground">{files.length} file(s): {fileSummary}</p>
          )}
          <Button onClick={upload} disabled={isUploading || files.length === 0}>
            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Upload payslips
          </Button>

          {uploaded.length > 0 && (
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium text-success">Saved</p>
              <ul className="mt-2 space-y-1 text-sm">
                {uploaded.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3">
                    <span>{row.employeeName} · {row.employeeId}</span>
                    <Badge variant="secondary">{row.period}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {unmatched.length > 0 && (
            <div className="rounded-lg border border-destructive/40 p-3">
              <p className="text-sm font-medium text-destructive">Needs attention</p>
              <ul className="mt-2 space-y-1 text-sm">
                {unmatched.map((row) => (
                  <li key={row.fileName}>
                    <span className="font-medium">{row.fileName}</span> — {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {errors.length > 0 && (
            <div className="rounded-lg border p-3 text-sm text-destructive">
              {errors.map((error) => (
                <p key={`${error.fileName}:${error.message}`}>
                  <span className="font-medium">{error.fileName}</span> — {error.message}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" /> Recent payslips ({period})
          </CardTitle>
          <CardDescription>Latest 200 uploaded documents for this period.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingRecent ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payslips uploaded for this period yet.</p>
          ) : (
            <ul className="divide-y">
              {recent.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{row.employeeName} · {row.employeeId}</span>
                  <span className="text-xs text-muted-foreground">{row.period}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
