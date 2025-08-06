
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Users, UserCheck, UserMinus, Clock, ArrowRight, UserPlus, Loader2, AlertCircle as AlertIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from "recharts";
import React, { useEffect, useState } from "react";
import { db, auth } from '@/lib/firebase';
import { collection, getCountFromServer, getDocs, query, where, Timestamp, orderBy, limit } from "firebase/firestore";
import type { Employee } from "@/types/employee";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format, subMonths, startOfMonth } from 'date-fns';
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { onAuthStateChanged, type User } from 'firebase/auth';


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
                <div className="h-8 flex items-center">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
            ) : error ? (
                <div className="text-sm text-destructive flex items-center gap-1"><AlertIcon className="h-4 w-4" /> Error</div>
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
    const [newHiresData, setNewHiresData] = useState<NewHiresData[]>([]);
    const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [userRole, setUserRole] = useState<string | null>(null);
    const [assignedDistricts, setAssignedDistricts] = useState<string[]>([]);


    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setCurrentUser(user);
                try {
                    const tokenResult = await user.getIdTokenResult();
                    const claims = tokenResult.claims;
                    setUserRole(claims.role as string || 'user'); // Default to 'user' if no role
                    setAssignedDistricts(claims.districts as string[] || []);
                } catch (e) {
                    console.error("Error getting user claims:", e);
                    setUserRole('user');
                    setAssignedDistricts([]);
                    setError("Could not verify user role.");
                }
            } else {
                setCurrentUser(null);
                setUserRole(null);
                setAssignedDistricts([]);
            }
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (userRole === null) { // Wait until we know the user's role
            return;
        }

        const fetchDashboardData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                let employeesRef: any = collection(db, "employees");

                // If field officer, filter by their assigned districts
                if (userRole === 'fieldOfficer' && assignedDistricts.length > 0) {
                    employeesRef = query(employeesRef, where('district', 'in', assignedDistricts));
                } else if (userRole === 'fieldOfficer' && assignedDistricts.length === 0) {
                    // Field officer has no assigned districts, so they see nothing.
                    setStats({ total: 0, active: 0, onLeave: 0, inactiveOrExited: 0 });
                    setNewHiresData([]);
                    setRecentActivity([]);
                    setIsLoading(false);
                    return;
                }

                const totalQuery = getCountFromServer(employeesRef);
                const activeQuery = getCountFromServer(query(employeesRef, where('status', '==', 'Active')));
                const onLeaveQuery = getCountFromServer(query(employeesRef, where('status', '==', 'OnLeave')));
                const inactiveQuery = getCountFromServer(query(employeesRef, where('status', 'in', ['Inactive', 'Exited'])));
                
                const sixMonthsAgo = startOfMonth(subMonths(new Date(), 5));
                const hiresQuery = query(employeesRef, where("joiningDate", ">=", Timestamp.fromDate(sixMonthsAgo)));
                
                const recentActivityQuery = query(employeesRef, orderBy("createdAt", "desc"), limit(5));

                const [
                    totalSnap,
                    activeSnap,
                    onLeaveSnap,
                    inactiveSnap,
                    hiresSnapshot,
                    recentActivitySnapshot
                ] = await Promise.all([
                    totalQuery,
                    activeQuery,
                    onLeaveQuery,
                    inactiveQuery,
                    getDocs(hiresQuery),
                    getDocs(recentActivityQuery)
                ]);
                
                setStats({
                    total: totalSnap.data().count,
                    active: activeSnap.data().count,
                    onLeave: onLeaveSnap.data().count,
                    inactiveOrExited: inactiveSnap.data().count,
                });

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
    }, [userRole, assignedDistricts]);

    const newHiresChartConfig = {
      hires: {
        label: "New Hires",
        color: "hsl(var(--chart-1))",
      },
    };

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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard title="Total Employees" value={stats?.total} icon={Users} isLoading={isLoading} error={error} />
                <StatCard title="Active Employees" value={stats?.active} icon={UserCheck} isLoading={isLoading} error={error} helpText={`${activePercentage} of total workforce`} />
                <StatCard title="Inactive & Exited" value={stats?.inactiveOrExited} icon={UserMinus} isLoading={isLoading} error={error} />
                <StatCard title="On Leave" value={stats?.onLeave} icon={Clock} isLoading={isLoading} error={error} />
            </div>
            <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
                <Card className="xl:col-span-2">
                    <CardHeader>
                        <CardTitle>New Hires - Last 6 Months</CardTitle>
                        <CardDescription>A monthly breakdown of new employee enrollments.</CardDescription>
                    </CardHeader>
                    <CardContent className="pl-2">
                        {isLoading ? <div className="h-[300px] flex justify-center items-center"><Loader2 className="h-8 w-8 animate-spin" /></div> : 
                        <ChartContainer config={newHiresChartConfig} className="w-full h-[300px]">
                            <BarChart data={newHiresData} accessibilityLayer>
                                <CartesianGrid vertical={false} />
                                <XAxis dataKey="month" tickLine={false} tickMargin={10} axisLine={false} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickMargin={10} />
                                <ChartTooltip cursor={{ fill: "hsl(var(--muted))" }} content={<ChartTooltipContent hideLabel />} />
                                <Bar dataKey="hires" fill="var(--color-hires)" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ChartContainer>
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
                                     <Avatar className="hidden h-10 w-10 sm:flex">
                                        <AvatarFallback><UserPlus className="h-5 w-5" /></AvatarFallback>
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
                             <p className="text-sm text-center text-muted-foreground py-8">No recent activity found.</p>
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
