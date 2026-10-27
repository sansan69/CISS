"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DownloadSimple as Download,
  FileText,
  SpinnerGap as Loader2,
} from "@phosphor-icons/react";

import { authorizedFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type PayslipRow = {
  id: string;
  period: string;
  fileName: string;
  sizeBytes: number;
  createdAt?: string;
  source?: "payroll" | "document";
};

export default function GuardPayslipsPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<PayslipRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await authorizedFetch("/api/guard/payslips");
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not load payslips.");
      setRows(body.payslips ?? []);
    } catch (error: any) {
      toast({ title: "Payslips", description: error?.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (row: PayslipRow) => {
    setDownloading(row.id);
    try {
      const response = await authorizedFetch(`/api/guard/payslips/${row.id}/payslip`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Could not download this payslip.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `payslip-${row.period}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ title: "Download failed", description: error?.message, variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Salary slips</h1>
        <p className="text-sm text-muted-foreground">
          Payslips uploaded by your administrator. Download a PDF copy for your records.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" /> My payslips
          </CardTitle>
          <CardDescription>Only slips linked to your employee record are shown.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payslips have been uploaded yet.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium">Payslip · {row.period}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.sizeBytes > 0
                        ? `${Math.max(1, Math.round(row.sizeBytes / 1024))} KB`
                        : row.source === "payroll"
                          ? "Payroll statement"
                          : "PDF"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {row.source === "payroll" ? "Payroll" : row.period || "PDF"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => download(row)}
                      disabled={downloading === row.id}
                    >
                      {downloading === row.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      Download
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
