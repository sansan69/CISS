
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, CheckCircle, AlertTriangle, Clock, Loader2, AlertCircle as AlertIcon } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import React, { useEffect, useState } from "react";
import { db } from '@/lib/firebase';
import { collection, getCountFromServer, getDocs, query, where, Timestamp } from "firebase/firestore";
import type { Employee } from "@/types/employee";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Mock data for weekly attendance - real data would require an attendance system
const weeklyAttendanceMockData = [
  { date: "Mon", present: 28, absent: 2, late: 1 },
  { date: "Tue", present: 29, absent: 1, late: 0 },
  { date: "Wed", present: 25, absent: 3, late: 2 },
  { date: "Thu", present: 30, absent: 0, late: 0 },
  { date: "Fri", present: 27, absent: 2, late: 1 },
  { date: "Sat", present: 15, absent: 0, late: 0 },
];

// Chart config colors are driven by CSS variables defined in globals.css
const barChartConfig = {
  present: { label: "Present", color: "hsl(var(--chart-1))" },
  absent: { label: "Absent", color: "hsl(var(--chart-2))" },
  late: { label: "Late", color: "hsl(var(--chart-3))" },
};

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
  color: string;
}

export default function DashboardPage() {
  const [timeRange, setTimeRange] = React.useState("last_7_days");
  
  const [totalEmployees, setTotalEmployees] = useState<number | null>(null);
  const [isLoadingTotalEmployees, setIsLoadingTotalEmployees] = useState(true);
  const [totalEmployeesError, setTotalEmployeesError] = useState<string | null>(null);

  const [clientDistribution, setClientDistribution] = useState<ClientDistributionData[]>([]);
  const [isLoadingClientDistribution, setIsLoadingClientDistribution] = useState(true);
  const [clientDistributionError, setClientDistributionError] = useState<string | null>(null);

  // State for mock data (to be replaced with real data fetching later)
  const [presentToday, setPresentToday] = useState(1150); // Mock
  const [absentToday, setAbsentToday] = useState(54); // Mock
  const [lateComers, setLateComers] = useState(30); // Mock

  useEffect(() => {
    const fetchTotalEmployees = async () => {
      setIsLoadingTotalEmployees(true);
      setTotalEmployeesError(null);
      try {
        const employeesColRef = collection(db, "employees");
        const snapshot = await getCountFromServer(employeesColRef);
        setTotalEmployees(snapshot.data().count);
      } catch (error: any) {
        console.error("Error fetching total employees:", error);
        if (error.code === 'permission-denied') {
          setTotalEmployeesError("Permission denied. Check Firestore rules to allow 'list' operations for admins.");
        } else {
          setTotalEmployeesError("Failed to fetch employee count.");
        }
        setTotalEmployees(0); // Fallback
      } finally {
        setIsLoadingTotalEmployees(false);
      }
    };

    const fetchClientDistribution = async () => {
      setIsLoadingClientDistribution(true);
      setClientDistributionError(null);
      try {
        const employeesSnapshot = await getDocs(collection(db, "employees"));
        const employeesData = employeesSnapshot.docs.map(doc => doc.data() as Employee);
        
        const countsByClient: { [key: string]: number } = {};
        employeesData.forEach(emp => {
          const client = emp.clientName || "Unassigned";
          countsByClient[client] = (countsByClient[client] || 0) + 1;
        });

        const formattedDistribution = Object.entries(countsByClient).map(([name, value], index) => ({
          name,
          value,
          color: THEME_CHART_COLORS[index % THEME_CHART_COLORS.length],
        }));
        setClientDistribution(formattedDistribution);

      } catch (error: any) {
        console.error("Error fetching client distribution:", error);
        if (error.code === 'permission-denied') {
          setClientDistributionError("Permission denied. Check Firestore rules to allow 'list' operations for admins.");
        } else {
          setClientDistributionError("Failed to fetch employee data for chart.");
        }
        setClientDistribution([]);
      } finally {
        setIsLoadingClientDistribution(false);
      }
    };

    fetchTotalEmployees();
    fetchClientDistribution();
    // Add logic here to fetch real data for presentToday, absentToday, lateComers
    // based on the 'timeRange' state and a dedicated attendance collection.
    // For now, they use mock values.

  }, [timeRange]); // Re-fetch if timeRange changes for attendance data

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
        <div className="flex items-center gap-2">
          <Label htmlFor="time-range">Time Range:</Label>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger id="time-range" className="w-[180px]">
              <SelectValue placeholder="Select time range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="last_7_days">Last 7 Days</SelectItem>
              <SelectItem value="last_30_days">Last 30 Days</SelectItem>
              <SelectItem value="this_month">This Month</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Employees</CardTitle>
            <Users className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingTotalEmployees ? (
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            ) : totalEmployeesError ? (
                <div className="text-xs text-destructive flex items-center gap-2">
                    <AlertIcon className="h-4 w-4" />
                    {totalEmployeesError}
                </div>
            ) : (
              <div className="text-2xl font-bold">{totalEmployees?.toLocaleString() ?? 'N/A'}</div>
            )}
            {/* <p className="text-xs text-muted-foreground">+20.1% from last month</p> */}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Present Today</CardTitle>
            <CheckCircle className="h-5 w-5 text-primary" /> {/* Use theme color */}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{presentToday}</div>
            <p className="text-xs text-muted-foreground">{totalEmployees ? ((presentToday / totalEmployees) * 100).toFixed(1) + '%' : '-'} of total (Mock Data)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Absent Today</CardTitle>
            <AlertTriangle className="h-5 w-5 text-destructive" /> {/* Use theme color */}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{absentToday}</div>
            <p className="text-xs text-muted-foreground">{totalEmployees ? ((absentToday / totalEmployees) * 100).toFixed(1) + '%' : '-'} of total (Mock Data)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Late Comers</CardTitle>
            <Clock className="h-5 w-5 text-accent" /> {/* Use theme color for warning/neutral */}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{lateComers}</div>
            <p className="text-xs text-muted-foreground">(Mock Data)</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="h-[400px] flex flex-col">
          <CardHeader>
            <CardTitle>Weekly Attendance Overview</CardTitle>
            <CardDescription>Present, Absent, and Late employees. (Mock Data)</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <ChartContainer config={barChartConfig} className="h-full w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyAttendanceMockData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false}/>
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="present" fill="var(--color-present)" radius={4} />
                  <Bar dataKey="absent" fill="var(--color-absent)" radius={4} />
                  <Bar dataKey="late" fill="var(--color-late)" radius={4} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
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
                <ChartContainer config={{}} className="h-full w-full max-w-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Pie
                        data={clientDistribution}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        labelLine={false}
                        label={({ name, percent, value }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                    >
                        {clientDistribution.map((entry) => (
                        <Cell key={`cell-${entry.name}`} fill={entry.color} />
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
