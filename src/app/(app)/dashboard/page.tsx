
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Users, UserCheck, UserMinus, Clock, ArrowRight, UserPlus, Loader2, AlertCircle as AlertIcon, CalendarClock } from "lucide-react";
import React, { useEffect, useState } from "react";
import { db, auth } from '@/lib/firebase';
import { collection, getCountFromServer, getDocs, query, where, Timestamp, orderBy, limit } from "firebase/firestore";
import type { Employee } from "@/types/employee";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format, subMonths, startOfMonth, startOfToday, addDays, endOfDay } from 'date-fns';
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, PieChart, Pie, Cell, Legend, XAxis, YAxis, CartesianGrid } from "recharts";
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Badge } from "@/components/ui/badge";


interface DashboardStats { total: number; active: number; onLeave: number; inactiveOrExited: number; }
interface NewHiresData { month: string; hires: number; }
interface RecentActivity { id: string; type: 'enrollment' | 'status_change'; text: string; subtext: string; timestamp: Date; }
interface UpcomingDuty {
  id: string;
  siteName: string;
  clientName: string;
  date: Date;
  totalManpower: number;
}
interface ClientDistributionData {
  name: string;
  value: number;
}

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
    const [clientDistributionData, setClientDistributionData] = useState<ClientDistributionData[]>([]);
    const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
    const [upcomingDuties, setUpcomingDuties] = useState<UpcomingDuty[]>([]);

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [userRole, setUserRole] = useState<string | null>(null);
    const [assignedDistricts, setAssignedDistricts] = useState<string[]>([]);
    // Ensure charts render only on client to avoid SSR/hydration issues in prod
    const [isMounted, setIsMounted] = useState(false);


    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setCurrentUser(user);
                try {
                    const tokenResult = await user.getIdTokenResult();
                    const claims = tokenResult.claims;
                    if (claims.admin) { 
                        setUserRole('admin');
                        setAssignedDistricts([]);
                    } else {
                        const officersRef = collection(db, "fieldOfficers");
                        const q = query(officersRef, where("uid", "==", user.uid));
                        const snapshot = await getDocs(q);
                        if (!snapshot.empty) {
                            const officerData = snapshot.docs[0].data();
                            setUserRole('fieldOfficer');
                            setAssignedDistricts(officerData.assignedDistricts || []);
                        } else {
                            setUserRole('user'); 
                            setAssignedDistricts([]);
                        }
                    }
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
        
        if (userRole === 'fieldOfficer' && assignedDistricts.length === 0) {
             setError("You have not been assigned to any districts. Please contact an administrator.");
             // Show stats for all employees if no districts assigned
        }

        const fetchDashboardData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                let employeesQueryBuilder: any = collection(db, "employees");

                // If field officer with districts, filter by their assigned districts. Otherwise (admin or FO with no districts), show all.
                if (userRole === 'fieldOfficer' && assignedDistricts.length > 0) {
                    employeesQueryBuilder = query(employeesQueryBuilder, where('district', 'in', assignedDistricts));
                }

                // --- Common Queries for all roles ---
                const totalQuery = getCountFromServer(employeesQueryBuilder);
                const activeQuery = getCountFromServer(query(employeesQueryBuilder, where('status', '==', 'Active')));
                const onLeaveQuery = getCountFromServer(query(employeesQueryBuilder, where('status', '==', 'OnLeave')));
                const inactiveQuery = getCountFromServer(query(employeesQueryBuilder, where('status', 'in', ['Inactive', 'Exited'])));
                
                // Start of the oldest month we want to include
                const sixMonthsAgo = startOfMonth(subMonths(new Date(), 5));
                const hiresQuery = query(
                    employeesQueryBuilder,
                    where("joiningDate", ">=", Timestamp.fromDate(sixMonthsAgo))
                );
                
                const recentActivityQuery = query(employeesQueryBuilder, orderBy("createdAt", "desc"), limit(5));
                
                // IMPORTANT: Client distribution chart should always show data for ALL employees, regardless of role.
                const allEmployeesForClientChart = getDocs(collection(db, "employees"));

                const queriesToRun: Promise<any>[] = [
                    totalQuery,
                    activeQuery,
                    onLeaveQuery,
                    inactiveQuery,
                    getDocs(hiresQuery),
                    getDocs(recentActivityQuery),
                    allEmployeesForClientChart
                ];

                // --- Field Officer Specific Query ---
                let dutiesQueryPromise: Promise<any> | null = null;
                if (userRole === 'fieldOfficer' && assignedDistricts.length > 0) {
                    const today = startOfToday();
                    const nextWeek = endOfDay(addDays(today, 6)); // end of 7th day from today
                    const dutiesQuery = query(
                        collection(db, "workOrders"),
                        where("district", "in", assignedDistricts),
                        where("date", ">=", Timestamp.fromDate(today)),
                        where("date", "<=", Timestamp.fromDate(nextWeek)),
                        orderBy("date", "asc"),
                        limit(10)
                    );
                    dutiesQueryPromise = getDocs(dutiesQuery);
                    queriesToRun.push(dutiesQueryPromise);
                }


                const [
                    totalSnap,
                    activeSnap,
                    onLeaveSnap,
                    inactiveSnap,
                    hiresSnapshot,
                    recentActivitySnapshot,
                    allEmployeesSnapshot,
                    dutiesSnapshot
                ] = await Promise.all(queriesToRun);
                
                // --- Process Common Data ---
                setStats({
                    total: totalSnap.data().count,
                    active: activeSnap.data().count,
                    onLeave: onLeaveSnap.data().count,
                    inactiveOrExited: inactiveSnap.data().count,
                });

                // Prepare month buckets for the last 6 months in chronological order
                const monthStarts: Date[] = [];
                for (let i = 5; i >= 0; i--) monthStarts.push(startOfMonth(subMonths(new Date(), i)));
                const monthLabels = monthStarts.map(d => format(d, 'MMM yyyy'));
                const hiresByMonth: Record<string, number> = Object.fromEntries(
                    monthLabels.map(label => [label, 0])
                );

                hiresSnapshot.docs.forEach((doc: any) => {
                    const data = doc.data();
                    let jsDate: Date | null = null;
                    const jd = data.joiningDate;
                    if (jd && typeof jd.toDate === 'function') {
                        jsDate = (jd as Timestamp).toDate();
                    } else if (typeof jd === 'string' || jd instanceof Date) {
                        const parsed = new Date(jd);
                        if (!isNaN(parsed.getTime())) jsDate = parsed;
                    }
                    if (jsDate) {
                        const monthKey = format(startOfMonth(jsDate), 'MMM yyyy');
                        if (monthKey in hiresByMonth) hiresByMonth[monthKey]++;
                    }
                });

                setNewHiresData(monthLabels.map(label => ({ month: label, hires: hiresByMonth[label] || 0 })));

                const clientCounts: { [key: string]: number } = {};
                allEmployeesSnapshot.docs.forEach((doc: any) => {
                    const clientName = doc.data().clientName || "Unassigned";
                    clientCounts[clientName] = (clientCounts[clientName] || 0) + 1;
                });
                setClientDistributionData(
                    Object.entries(clientCounts)
                        .map(([name, value]) => ({ name, value }))
                        .sort((a, b) => b.value - a.value)
                );


                setRecentActivity(recentActivitySnapshot.docs.map((doc: any) => {
                    const data = doc.data() as Employee;
                    return {
                        id: doc.id,
                        type: 'enrollment',
                        text: `${data.fullName} was enrolled.`,
                        subtext: `Assigned to ${data.clientName}`,
                        timestamp: (data.createdAt as Timestamp).toDate()
                    };
                }));

                // --- Process Field Officer Data ---
                if (dutiesSnapshot) {
                    setUpcomingDuties(dutiesSnapshot.docs.map((doc: any) => {
                        const data = doc.data();
                        return {
                            id: doc.id,
                            siteName: data.siteName,
                            clientName: data.clientName,
                            date: (data.date as Timestamp).toDate(),
                            totalManpower: data.totalManpower,
                        }
                    }))
                }

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
    
    const clientChartColors = [
        "hsl(var(--chart-1))",
        "hsl(var(--chart-2))",
        "hsl(var(--chart-3))",
        "hsl(var(--chart-4))",
        "hsl(var(--chart-5))",
    ];

    const clientChartConfig = {
      clients: {
        label: "Clients",
      },
      ...clientDistributionData.reduce((acc, client) => {
            acc[client.name] = {
                label: client.name,
                // The color will be assigned dynamically in the Pie component
            };
            return acc;
      }, {} as any)
    };


    if (error && userRole === 'fieldOfficer' && assignedDistricts.length === 0) {
        return (
            <Alert variant="destructive" className="w-full">
                <AlertIcon className="h-4 w-4" />
                <AlertTitle>Assignment Pending</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        );
    }

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

            {userRole === 'fieldOfficer' && (
                 <Card>
                    <CardHeader>
                        <CardTitle>Upcoming Duties - Next 7 Days</CardTitle>
                        <CardDescription>A summary of guard requirements in your assigned districts.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="h-24 flex justify-center items-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                        ) : upcomingDuties.length > 0 ? (
                            <div className="space-y-3">
                                {upcomingDuties.map(duty => (
                                    <div key={duty.id} className="flex items-center justify-between p-3 border rounded-md">
                                        <div>
                                            <p className="font-semibold">{duty.siteName} <span className="font-normal text-muted-foreground">({duty.clientName})</span></p>
                                            <p className="text-sm text-muted-foreground">{format(duty.date, "EEEE, dd MMM yyyy")}</p>
                                        </div>
                                        <Badge>Total Required: {duty.totalManpower}</Badge>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-center text-muted-foreground py-6">No upcoming duties found in your districts for the next 7 days.</p>
                        )}
                    </CardContent>
                    <CardFooter>
                         <Button asChild size="sm" className="w-full">
                            <Link href="/work-orders"><CalendarClock className="mr-2 h-4 w-4" />View All Work Orders</Link>
                        </Button>
                    </CardFooter>
                </Card>
            )}

            <div className="grid gap-6 lg:grid-cols-3">
                <div className="grid gap-6 lg:col-span-2">
                    <Card>
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
                                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickMargin={10} allowDecimals={false} />
                                    <ChartTooltip cursor={{ fill: "hsl(var(--muted))" }} content={<ChartTooltipContent hideLabel />} />
                                    <Bar dataKey="hires" fill="var(--color-hires)" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ChartContainer>
                            }
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Employee Distribution by Client</CardTitle>
                            <CardDescription>A breakdown of the workforce by client assignment.</CardDescription>
                        </CardHeader>
                        <CardContent>
                        {isLoading ? (
                            <div className="h-[250px] flex justify-center items-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
                        ) : !isMounted ? (
                            <div className="h-[250px] flex justify-center items-center text-muted-foreground">Preparing chart...</div>
                        ) : clientDistributionData.length > 0 ? (
                            <ChartContainer config={clientChartConfig} className="w-full h-[300px]">
                                <PieChart>
                                    <ChartTooltip content={<ChartTooltipContent nameKey="value" hideLabel />} />
                                    <Pie data={clientDistributionData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                                            {clientDistributionData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={clientChartColors[index % clientChartColors.length]} />
                                        ))}
                                    </Pie>
                                    <Legend />
                                </PieChart>
                            </ChartContainer>
                        ) : (
                            <p className="text-center text-muted-foreground py-10">No employee data to display chart.</p>
                        )}
                        </CardContent>
                    </Card>
                </div>
                <Card className="lg:col-span-1">
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
