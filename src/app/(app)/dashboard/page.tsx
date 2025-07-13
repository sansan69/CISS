
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, CheckCircle, AlertTriangle, Clock, Loader2, AlertCircle as AlertIcon, UserMinus, UserCheck } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell, LabelList } from "recharts";
import React, { useEffect, useState } from "react";
import { db } from '@/lib/firebase';
import { collection, getCountFromServer, getDocs, query, where, Timestamp } from "firebase/firestore";
import type { Employee } from "@/types/employee";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';


const THEME_CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

interface ClientDistributionData {
  name: string;
  value: number;
  fill: string;
}

interface DashboardStats {
    total: number;
    active: number;
    onLeave: number;
    inactiveOrExited: number;
}

interface NewHiresData {
    month: string;
    hires: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [clientDistribution, setClientDistribution] = useState<ClientDistributionData[]>([]);
  const [isLoadingClientDistribution, setIsLoadingClientDistribution] = useState(true);
  const [clientDistributionError, setClientDistributionError] = useState<string | null>(null);
  
  const [newHiresData, setNewHiresData] = useState<NewHiresData[]>([]);
  const [isLoadingHires, setIsLoadingHires] = useState(true);
  const [hiresError, setHiresError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      setIsLoadingStats(true);
      setIsLoadingClientDistribution(true);
      setIsLoadingHires(true);
      setStatsError(null);
      setClientDistributionError(null);
      setHiresError(null);

      try {
        // --- Fetch all data in parallel ---
        const [statsData, clientData, hiresData] = await Promise.all([
          fetchStats(),
          fetchClientDistribution(),
          fetchNewHires(),
        ]);

        setStats(statsData);
        setClientDistribution(clientData);
        setNewHiresData(hiresData);

      } catch (error: any) {
        console.error("Error fetching dashboard data:", error);
        if (error.code === 'permission-denied' || error.message.includes('permission-denied')) {
          const permissionError = "Permission denied. Check Firestore rules to allow 'list' and 'aggregate' operations for admins.";
          setStatsError(permissionError);
          setClientDistributionError(permissionError);
          setHiresError(permissionError);
        } else {
          const genericError = "Failed to fetch dashboard data.";
          setStatsError(genericError);
          setClientDistributionError(genericError);
          setHiresError(genericError);
        }
      } finally {
        setIsLoadingStats(false);
        setIsLoadingClientDistribution(false);
        setIsLoadingHires(false);
      }
    };
    
    fetchDashboardData();

  }, []);

  const fetchStats = async (): Promise<DashboardStats> => {
      const employeesRef = collection(db, "employees");
      const totalQuery = getCountFromServer(employeesRef);
      const activeQuery = getCountFromServer(query(employeesRef, where('status', '==', 'Active')));
      const onLeaveQuery = getCountFromServer(query(employeesRef, where('status', '==', 'OnLeave')));
      const inactiveQuery = getCountFromServer(query(employeesRef, where('status', 'in', ['Inactive', 'Exited'])));
      
      const [totalSnap, activeSnap, onLeaveSnap, inactiveSnap] = await Promise.all([totalQuery, activeQuery, onLeaveQuery, inactiveQuery]);

      return {
          total: totalSnap.data().count,
          active: activeSnap.data().count,
          onLeave: onLeaveSnap.data().count,
          inactiveOrExited: inactiveSnap.data().count,
      };
  };

  const fetchClientDistribution = async (): Promise<ClientDistributionData[]> => {
      const employeesSnapshot = await getDocs(collection(db, "employees"));
      const employeesData = employeesSnapshot.docs.map(doc => doc.data() as Employee);
      
      const countsByClient: { [key: string]: number } = {};
      employeesData.forEach(emp => {
        const client = emp.clientName || "Unassigned";
        countsByClient[client] = (countsByClient[client] || 0) + 1;
      });

      return Object.entries(countsByClient).map(([name, value], index) => ({
        name,
        value,
        fill: THEME_CHART_COLORS[index % THEME_CHART_COLORS.length],
      }));
  };
  
  const fetchNewHires = async (): Promise<NewHiresData[]> => {
    const sixMonthsAgo = startOfMonth(subMonths(new Date(), 5)); // Include current month
    const hiresQuery = query(collection(db, "employees"), where("joiningDate", ">=", Timestamp.fromDate(sixMonthsAgo)));
    const snapshot = await getDocs(hiresQuery);

    const hiresByMonth: { [key: string]: number } = {};
    
    // Initialize last 6 months
    for (let i = 0; i < 6; i++) {
        const monthDate = subMonths(new Date(), i);
        const monthKey = format(monthDate, 'MMM yyyy');
        hiresByMonth[monthKey] = 0;
    }

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.joiningDate) {
            const joiningDate = (data.joiningDate as Timestamp).toDate();
            const monthKey = format(joiningDate, 'MMM yyyy');
            if (hiresByMonth.hasOwnProperty(monthKey)) {
                hiresByMonth[monthKey]++;
            }
        }
    });

    return Object.entries(hiresByMonth)
      .map(([month, hires]) => ({ month, hires }))
      .reverse(); // To show oldest month first
  };

  const newHiresChartConfig = {
      hires: { label: "New Hires", color: "hsl(var(--chart-1))" },
  };

  const clientChartConfig = clientDistribution.reduce((acc, client) => {
    acc[client.name] = { label: client.name, color: client.fill };
    return acc;
  }, {} as any);


  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Employees</CardTitle>
            <Users className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            ) : statsError ? (
                <div className="text-xs text-destructive flex items-center gap-2">
                    <AlertIcon className="h-4 w-4" />
                    {statsError}
                </div>
            ) : (
              <div className="text-2xl font-bold">{stats?.total?.toLocaleString() ?? 'N/A'}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Employees</CardTitle>
            <UserCheck className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
             {isLoadingStats ? (
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            ) : statsError ? (
                <div className="text-xs text-destructive flex items-center gap-2">...</div>
            ) : (
                <>
                    <div className="text-2xl font-bold">{stats?.active?.toLocaleString() ?? 'N/A'}</div>
                    <p className="text-xs text-muted-foreground">
                        {stats?.total ? ((stats.active / stats.total) * 100).toFixed(1) + '%' : '-%'} of total
                    </p>
                </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inactive &amp; Exited</CardTitle>
            <UserMinus className="h-5 w-5 text-destructive" />
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            ) : statsError ? (
                <div className="text-xs text-destructive flex items-center gap-2">...</div>
            ) : (
                <div className="text-2xl font-bold">{stats?.inactiveOrExited?.toLocaleString() ?? 'N/A'}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">On Leave</CardTitle>
            <Clock className="h-5 w-5 text-accent" />
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            ) : statsError ? (
                <div className="text-xs text-destructive flex items-center gap-2">...</div>
            ) : (
                 <div className="text-2xl font-bold">{stats?.onLeave?.toLocaleString() ?? 'N/A'}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <Card className="h-[400px] flex flex-col">
          <CardHeader>
            <CardTitle>New Hires - Last 6 Months</CardTitle>
            <CardDescription>Number of employees who joined each month.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex items-center justify-center">
             {isLoadingHires ? (
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
             ) : hiresError ? (
                <Alert variant="destructive" className="w-full">
                    <AlertIcon className="h-4 w-4" />
                    <AlertTitle>Error Loading Chart</AlertTitle>
                    <AlertDescription>{hiresError}</AlertDescription>
                </Alert>
             ) : newHiresData.length === 0 ? (
                <p className="text-muted-foreground">No new hire data in the last 6 months.</p>
             ) : (
                <ChartContainer config={newHiresChartConfig} className="h-full w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={newHiresData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false}/>
                      <XAxis dataKey="month" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="hires" fill="var(--color-hires)" radius={4}>
                        <LabelList dataKey="hires" position="top" offset={5} className="fill-foreground text-xs"/>
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
             )}
          </CardContent>
        </Card>

        <Card className="h-[400px] flex flex-col">
          <CardHeader>
            <CardTitle>Employee Distribution by Client</CardTitle>
            <CardDescription>Number of employees assigned to each client.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex items-center justify-center">
            {isLoadingClientDistribution ? (
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            ) : clientDistributionError ? (
                <Alert variant="destructive" className="w-full">
                    <AlertIcon className="h-4 w-4" />
                    <AlertTitle>Error Loading Chart</AlertTitle>
                    <AlertDescription>
                        {clientDistributionError}
                    </AlertDescription>
                </Alert>
            ) : clientDistribution.length === 0 ? (
                <p className="text-muted-foreground">No client data available.</p>
            ) : (
                <ChartContainer config={clientChartConfig} className="h-full w-full max-w-[350px] aspect-square">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="value" hideLabel />} />
                    <Pie
                        data={clientDistribution}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={120}
                        innerRadius={50}
                        labelLine={false}
                        label={({ name, percent, value, x, y }) => (
                           <text
                                x={x}
                                y={y}
                                textAnchor={x > 175 ? "start" : "end"} // 175 is half of 350 (container width)
                                dominantBaseline="central"
                                fill="hsl(var(--foreground))"
                                fontSize={12}
                            >
                              {`${name} (${(percent * 100).toFixed(0)}%)`}
                            </text>
                        )}
                    >
                        {clientDistribution.map((entry) => (
                          <Cell key={`cell-${entry.name}`} fill={entry.fill} />
                        ))}
                    </Pie>
                    <ChartLegend content={<ChartLegendContent nameKey="name" />} />
                    </PieChart>
                </ResponsiveContainer>
                </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
