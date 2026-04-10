"use client";

import { ChartContainer } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

interface NewHiresData { month: string; hires: number; }
interface ClientCoverage { clientName: string; totalGuards: number; }

interface DashboardChartsProps {
  role: string;
  newHiresData?: NewHiresData[];
  clientCoverage?: ClientCoverage[];
}

export function DashboardCharts({ role, newHiresData, clientCoverage }: DashboardChartsProps) {
  const showFullCharts = role === 'admin' || role === 'superAdmin' || role === 'hr' || role === 'accounts';
  
  if (!showFullCharts || !newHiresData) return null;

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">New Hires (Last 6 Months)</h3>
        <ChartContainer config={{}} className="h-[200px]">
          <BarChart data={newHiresData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Bar dataKey="hires" fill="var(--color-brand-blue)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </div>
      
      {clientCoverage && clientCoverage.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Guard Distribution</h3>
          <div className="space-y-2">
            {clientCoverage.slice(0, 5).map((client) => (
              <div key={client.clientName} className="flex items-center justify-between p-2 bg-muted rounded">
                <span className="text-sm truncate">{client.clientName}</span>
                <span className="font-medium">{client.totalGuards}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}