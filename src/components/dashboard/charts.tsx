"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { format } from "date-fns";
import { ArrowRight, DownloadSimple as FileDown, SpinnerGap } from "@phosphor-icons/react";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { downloadCsv, type TabularRow } from "@/lib/spreadsheets/browser";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

interface NewHiresData { month: string; hires: number; }
interface ClientCoverage {
  clientName: string;
  totalGuards: number;
  activeGuards: number;
  checkedInToday: number;
  coveragePct: number;
  mockLocationAlerts: number;
}

interface DashboardChartsProps {
  role: string;
  newHiresData?: NewHiresData[];
  clientCoverage?: ClientCoverage[];
}

const chartConfig = {
  hires: { label: "New hires", color: "var(--color-brand-blue)" },
  coverage: { label: "On duty %", color: "var(--color-brand-blue)" },
};

export function DashboardCharts({ role, newHiresData, clientCoverage }: DashboardChartsProps) {
  const showFullCharts = role === 'admin' || role === 'superAdmin' || role === 'hr' || role === 'accounts';
  const [exporting, setExporting] = useState(false);

  const handleExportCoverage = useCallback(async () => {
    const rows = clientCoverage ?? [];
    if (rows.length === 0) return;
    setExporting(true);
    try {
      const data: TabularRow[] = [
        ["Client", "Total Guards", "Active Guards", "Checked In Today", "Coverage %", "Mock Location Alerts"],
        ...rows.map((row) => [
          row.clientName,
          row.totalGuards,
          row.activeGuards,
          row.checkedInToday,
          `${row.coveragePct}%`,
          row.mockLocationAlerts,
        ]),
      ];
      downloadCsv(`ciss-client-coverage-${format(new Date(), "yyyy-MM-dd")}.csv`, data);
      toast({ title: "Export ready", description: "Client coverage downloaded as CSV." });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: error?.message || "Could not export coverage.",
      });
    } finally {
      setExporting(false);
    }
  }, [clientCoverage]);

  if (!showFullCharts || !newHiresData) return null;

  const topClients = (clientCoverage ?? [])
    .filter((client) => client.totalGuards > 0)
    .slice(0, 5);

  return (
    <section aria-labelledby="dashboard-charts-title" className="space-y-4">
      <div className="flex items-end justify-between gap-4 px-0.5">
        <div>
          <h2 id="dashboard-charts-title" className="text-base font-bold tracking-tight text-foreground sm:text-lg">
            Workforce insights
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Hiring momentum and guard distribution across clients
          </p>
        </div>
        {clientCoverage && clientCoverage.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCoverage}
            disabled={exporting}
            className="shrink-0"
          >
            {exporting ? (
              <SpinnerGap className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <FileDown className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            )}
            Export CSV
          </Button>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
          <h3 className="text-sm font-bold text-foreground mb-1">New Hires</h3>
          <p className="mb-4 text-xs text-muted-foreground">Last 6 months</p>
          <ChartContainer config={chartConfig} className="h-[200px]">
            <BarChart data={newHiresData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                content={
                  <ChartTooltipContent
                    labelKey="month"
                    formatter={(value) => [`${value} hire${Number(value) === 1 ? "" : "s"}`, "New hires"]}
                  />
                }
                cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
              />
              <Bar dataKey="hires" fill="var(--color-brand-blue)" radius={[4, 4, 0, 0]} maxBarSize={42} />
            </BarChart>
          </ChartContainer>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-foreground mb-1">Guard Distribution</h3>
              <p className="text-xs text-muted-foreground">Top clients by guard strength</p>
            </div>
            <Link
              href="/settings/clients"
              className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-blue transition-colors hover:text-primary"
            >
              All clients
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {topClients.length > 0 ? (
            <ChartContainer config={chartConfig} className="mt-4 h-[200px]">
              <BarChart
                data={topClients}
                layout="vertical"
                margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="clientName"
                  width={92}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={
                    <ChartTooltipContent
                      labelKey="clientName"
                      formatter={(value, name, item: any) => [
                        `${item?.payload?.checkedInToday ?? 0}/${item?.payload?.activeGuards ?? 0} on duty · ${value}%`,
                        "Coverage",
                      ]}
                    />
                  }
                  cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                />
                <Bar dataKey="coveragePct" fill="var(--color-brand-blue)" radius={[0, 4, 4, 0]} maxBarSize={16} />
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No client data yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
