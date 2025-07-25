
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Users, UserCheck, UserMinus, Clock, Activity, Loader2, AlertCircle as AlertIcon, ArrowRight, UserPlus } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import React, { useEffect, useState } from "react";
import { db } from '@/lib/firebase';
import { collection, getCountFromServer, getDocs, query, where, Timestamp, orderBy, limit } from "firebase/firestore";
import type { Employee } from "@/types/employee";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format, subMonths, startOfMonth } from 'date-fns';
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

interface ClientDistributionData { name: string; value: number; fill: string; }
interface DashboardStats { total: number; active: number; onLeave: number; inactiveOrExited: number; }
interface NewHiresData { month: string; hires: number; }
interface RecentActivity { id: string; type: 'enrollment' | 'status_change'; text: string; subtext: string; timestamp: Date; }


const StatCard: React.FC<{ title: string; value?: number; icon: React.ElementType; isLoading: boolean; error: string | null; helpText?: string }> = 
({ title, value, icon: Icon, isLoading, error, helpText }) => (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
            {isLoading ? (
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : error ? (
                <div className="text-xs text-destructive flex items-center gap-1"><AlertIcon className="h-4 w-4" /> Error</div>
            ) : (
                <>
                    <div className="text-2xl font-bold">{value?.toLocaleString() ?? 'N/A'}</div>
                    {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
                </>
            )}
        </CardContent>
    </Card>
);


export default function DashboardPage() {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [clientDistribution, setClientDistribution] = useState<ClientDistributionData[]>([]);
    const [newHiresData, setNewHiresData] = useState<NewHiresData[]>([]);
    const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchDashboardData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const employeesRef = collection(db, "employees");

                const totalQuery = getCountFromServer(employeesRef);
                const activeQuery = getCountFromServer(query(employeesRef, where('status', '==', 'Active')));
                const onLeaveQuery = getCountFromServer(query(employeesRef, where('status', '==', 'OnLeave')));
                const inactiveQuery = getCountFromServer(query(employeesRef, where('status', 'in', ['Inactive', 'Exited'])));
                
                const sixMonthsAgo = startOfMonth(subMonths(new Date(), 5));
                const hiresQuery = query(collection(db, "employees"), where("joiningDate", ">=", Timestamp.fromDate(sixMonthsAgo)));
                
                const recentActivityQuery = query(collection(db, "employees"), orderBy("createdAt", "desc"), limit(5));

                const [
                    totalSnap,
                    activeSnap,
                    onLeaveSnap,
                    inactiveSnap,
                    allEmployeesSnap,
                    hiresSnapshot,
                    recentActivitySnapshot
                ] = await Promise.all([
                    totalQuery,
                    activeQuery,
                    onLeaveQuery,
                    inactiveQuery,
                    getDocs(employeesRef),
                    getDocs(hiresQuery),
                    getDocs(recentActivityQuery)
                ]);
                
                // Process Stats
                const total = totalSnap.data().count;
                const active = activeSnap.data().count;
                setStats({
                    total,
                    active,
                    onLeave: onLeaveSnap.data().count,
                    inactiveOrExited: inactiveSnap.data().count,
                });

                // Process Client Distribution
                const employeesData = allEmployeesSnap.docs.map(doc => doc.data() as Employee);
                const countsByClient: { [key: string]: number } = {};
                employeesData.forEach(emp => {
                    const client = emp.clientName || "Unassigned";
                    countsByClient[client] = (countsByClient[client] || 0) + 1;
                });
                setClientDistribution(Object.entries(countsByClient).map(([name, value], index) => ({
                    name,
                    value,
                    fill: CHART_COLORS[index % CHART_COLORS.length],
                })));
                
                // Process New Hires
                const hiresByMonth: { [key: string]: number } = {};
                for (let i = 0; i < 6; i++) {
                    hiresByMonth[format(subMonths(new Date(), i), 'MMM yyyy')] = 0;
                }
                hiresSnapshot.docs.forEach(doc => {
                    const data = doc.data();
                    if (data.joiningDate) {
                        const monthKey = format((data.joiningDate as Timestamp).toDate(), 'MMM yyyy');
                        if (hiresByMonth.hasOwnProperty(monthKey)) hiresByMonth[monthKey]++;
                    }
                });
                setNewHiresData(Object.entries(hiresByMonth).map(([month, hires]) => ({ month, hires })).reverse());

                // Process Recent Activity
                setRecentActivity(recentActivitySnapshot.docs.map(doc => {
                    const data = doc.data() as Employee;
                    return {
                        id: doc.id,
                        type: 'enrollment',
                        text: `${data.fullName} was enrolled.`,
                        subtext: `Assigned to ${data.clientName}`,
                        timestamp: (data.createdAt as Timestamp).toDate()
                    };
                }));

            } catch (err: any) {
                console.error("Error fetching dashboard data:", err);
                let message = "Failed to fetch dashboard data.";
                if(err.code === 'permission-denied') message = "Permission Denied: Check Firestore rules.";
                if(err.code === 'failed-precondition') message = "A required database index is missing. Please check the browser's developer console for a link to create it.";
                setError(message);
            } finally {
                setIsLoading(false);
            }
        };
        fetchDashboardData();
    }, []);

    const newHiresChartConfig = { hires: { label: "New Hires" } };
    const clientChartConfig = clientDistribution.reduce((acc, client) => ({ ...acc, [client.name]: { label: client.name, color: client.fill } }), {});

    if (error) {
        return (
            <Alert variant="destructive" className="w-full">
                <AlertIcon className="h-4 w-4" />
                <AlertTitle>Error Loading Dashboard</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        );
    }
    
    const activePercentage = stats && stats.total > 0 ? ((stats.active / stats.total) * 100).toFixed(0) + '%' : '-';

    return (
        <div className="flex flex-col gap-6">
            <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
                <StatCard title="Total Employees" value={stats?.total} icon={Users} isLoading={isLoading} error={error} />
                <StatCard title="Active Employees" value={stats?.active} icon={UserCheck} isLoading={isLoading} error={error} helpText={`${activePercentage} of total workforce`} />
                <StatCard title="Inactive & Exited" value={stats?.inactiveOrExited} icon={UserMinus} isLoading={isLoading} error={error} />
                <StatCard title="On Leave" value={stats?.onLeave} icon={Clock} isLoading={isLoading} error={error} />
            </div>
            <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-3">
                <Card className="xl:col-span-2">
                    <CardHeader>
                        <CardTitle>New Hires - Last 6 Months</CardTitle>
                    </CardHeader>
                    <CardContent className="pl-2">
                        {isLoading ? <div className="h-[300px] flex justify-center items-center"><Loader2 className="h-8 w-8 animate-spin" /></div> : 
                        <ResponsiveContainer width="100%" height={300}>
                             <BarChart data={newHiresData}>
                                <CartesianGrid vertical={false} />
                                <XAxis dataKey="month" tickLine={false} tickMargin={10} axisLine={false} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickMargin={10} />
                                <ChartTooltip cursor={{ fill: "hsl(var(--muted))" }} content={<ChartTooltipContent hideLabel />} />
                                <Bar dataKey="hires" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                        }
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Recent Activity</CardTitle>
                        <CardDescription>Latest enrollments in the system.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-6">
                        {isLoading ? (
                            Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
                                        <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
                                    </div>
                                </div>
                            ))
                        ) : recentActivity.length > 0 ? (
                            recentActivity.map((activity) => (
                                <div key={activity.id} className="flex items-center gap-4">
                                     <Avatar className="hidden h-9 w-9 sm:flex">
                                        <AvatarFallback><Activity className="h-5 w-5" /></AvatarFallback>
                                    </Avatar>
                                    <div className="grid gap-1">
                                        <p className="text-sm font-medium leading-none">{activity.text}</p>
                                        <p className="text-sm text-muted-foreground">{activity.subtext}</p>
                                    </div>
                                    <Link href={`/employees/${activity.id}`} className="ml-auto">
                                       <Button variant="ghost" size="sm">View</Button>
                                    </Link>
                                </div>
                            ))
                        ) : (
                             <p className="text-sm text-muted-foreground">No recent activity found.</p>
                        )}
                    </CardContent>
                    <CardFooter>
                        <Button asChild size="sm" className="w-full">
                            <Link href="/employees"><ArrowRight className="mr-2 h-4 w-4" />View All Employees</Link>
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        </div>
    );
}
