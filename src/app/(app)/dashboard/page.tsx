
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Users, UserCheck, UserMinus, Clock, ArrowRight, UserPlus, Loader2, AlertCircle as AlertIcon, CalendarClock } from "lucide-react";
import React, { useEffect, useState } from "react";
import { db, auth } from '@/lib/firebase';
import { collection, getCountFromServer, getDocs, query, where, Timestamp, orderBy, limit, doc, getDoc, onSnapshot } from "firebase/firestore";
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
import { resolveAppUser } from '@/lib/auth/roles';
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";


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
    const [clientInfo, setClientInfo] = useState<{ clientId: string; clientName: string } | null>(null);
    const [todayLogs, setTodayLogs] = useState<any[]>([]);
    const [clientAttendance, setClientAttendance] = useState<{ inToday: number; outToday: number; onDuty: number }>({ inToday: 0, outToday: 0, onDuty: 0 });
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
                    const appUser = await resolveAppUser(user);
                    setUserRole(appUser.role);
                    setAssignedDistricts(appUser.assignedDistricts);
                    setClientInfo(
                        appUser.clientId && appUser.clientName
                            ? { clientId: appUser.clientId, clientName: appUser.clientName }
                            : null
                    );
                } catch (e) {
                    console.error("Error getting user claims:", e);
                    setUserRole('user');
                    setAssignedDistricts([]);
                    setClientInfo(null);
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
                } else if (userRole === 'client' && clientInfo?.clientName) {
                    employeesQueryBuilder = query(employeesQueryBuilder, where('clientName', '==', clientInfo.clientName));
                }

                // --- Common Queries for all roles ---
                const totalQuery = getCountFromServer(employeesQueryBuilder);
                const activeQuery = getCountFromServer(query(employeesQueryBuilder, where('status', '==', 'Active')));
                const onLeaveQuery = getCountFromServer(query(employeesQueryBuilder, where('status', '==', 'OnLeave')));
                const inactiveQuery = getCountFromServer(query(employeesQueryBuilder, where('status', 'in', ['Inactive', 'Exited'])));
                
                // Start of the oldest month we want to include
                const sixMonthsAgo = startOfMonth(subMonths(new Date(), 5));
                const includeCharts = userRole !== 'fieldOfficer' && userRole !== 'client';
                // Avoid composite-index requirement for FO and skip unnecessary chart queries
                // Use createdAt to reflect actual enrollment counts; fallback handled during tally
                let hiresDocsPromise: Promise<any> = includeCharts
                    ? getDocs(query(
                        employeesQueryBuilder,
                        where("createdAt", ">=", Timestamp.fromDate(sixMonthsAgo))
                      ))
                    : Promise.resolve({ docs: [] });
                
                const recentActivityQuery = query(employeesQueryBuilder, orderBy("createdAt", "desc"), limit(5));
                
                // IMPORTANT: Client distribution chart uses ALL employees; skip for FO
                const allEmployeesForClientChart = includeCharts
                    ? getDocs(collection(db, "employees"))
                    : Promise.resolve({ docs: [] });

                const queriesToRun: Promise<any>[] = [
                    totalQuery,
                    activeQuery,
                    onLeaveQuery,
                    inactiveQuery,
                    hiresDocsPromise,
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
                    // Prefer createdAt (enrollment), fallback to joiningDate
                    let jsDate: Date | null = null;
                    const cd = data.createdAt;
                    const jd = data.joiningDate;
                    const coerceDate = (val: any): Date | null => {
                        if (!val) return null;
                        if (typeof val.toDate === 'function') return (val as Timestamp).toDate();
                        if (typeof val === 'string' || val instanceof Date) {
                            const parsed = new Date(val);
                            return isNaN(parsed.getTime()) ? null : parsed;
                        }
                        return null;
                    };
                    jsDate = coerceDate(cd) || coerceDate(jd);
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
    }, [userRole, assignedDistricts, clientInfo]);

    // Live attendance stream for client users
    useEffect(() => {
        if (userRole !== 'client' || !clientInfo?.clientName) return;
        const todayStart = startOfToday();
        const qLogs = query(
            collection(db, 'attendanceLogs'),
            where('clientName', '==', clientInfo.clientName),
            where('createdAt', '>=', Timestamp.fromDate(todayStart)),
            orderBy('createdAt', 'desc')
        );
        const unsub = onSnapshot(qLogs, (snap) => {
            const logs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            setTodayLogs(logs);
            // Compute by-employee latest status
            const latestByEmp = new Map<string, any>();
            const seenIn = new Set<string>();
            const seenOut = new Set<string>();
            logs.forEach(l => {
                const empId = l.employeeId;
                if (l.status === 'In') seenIn.add(empId);
                if (l.status === 'Out') seenOut.add(empId);
                const prev = latestByEmp.get(empId);
                const prevTs = prev?.createdAt?.toMillis ? prev.createdAt.toMillis() : (prev?.createdAt instanceof Date ? prev.createdAt.getTime() : 0);
                const curTs = l.createdAt?.toMillis ? l.createdAt.toMillis() : (l.createdAt instanceof Date ? l.createdAt.getTime() : 0);
                if (!prev || curTs > prevTs) latestByEmp.set(empId, l);
            });
            let onDuty = 0;
            latestByEmp.forEach((log) => { if (log.status === 'In') onDuty++; });
            setClientAttendance({ inToday: seenIn.size, outToday: seenOut.size, onDuty });
        });
        return () => unsub();
    }, [userRole, clientInfo]);

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
        <div className="flex flex-col gap-4 sm:gap-6">
            <PageHeader
                eyebrow="Overview"
                title="Workforce Dashboard"
                description="Track workforce health, attendance flow, and operational activity without losing the actions that need attention."
            />
            <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                                    <div key={duty.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <p className="font-semibold">{duty.siteName} <span className="font-normal text-muted-foreground">({duty.clientName})</span></p>
                                            <p className="text-sm text-muted-foreground">{format(duty.date, "EEEE, dd MMM yyyy")}</p>
                                        </div>
                                        <Badge className="w-fit">Total Required: {duty.totalManpower}</Badge>
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

            <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
                {userRole !== 'fieldOfficer' && userRole !== 'client' && (
                    <div className="grid gap-6 lg:col-span-2">
                        <Card>
                            <CardHeader className="pb-2 sm:pb-4">
                                <CardTitle>New Hires - Last 6 Months</CardTitle>
                                <CardDescription>A monthly breakdown of new employee enrollments.</CardDescription>
                            </CardHeader>
                            <CardContent className="px-2 sm:px-4">
                                {isLoading ? <div className="h-[220px] md:h-[300px] flex justify-center items-center"><Loader2 className="h-8 w-8 animate-spin" /></div> : 
                                <ChartContainer config={newHiresChartConfig} className="w-full h-[220px] md:h-[300px]">
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
                            <CardHeader className="pb-2 sm:pb-4">
                                <CardTitle>Employee Distribution by Client</CardTitle>
                                <CardDescription>A breakdown of the workforce by client assignment.</CardDescription>
                            </CardHeader>
                            <CardContent>
                            {isLoading ? (
                                <div className="h-[200px] md:h-[250px] flex justify-center items-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
                            ) : !isMounted ? (
                                <div className="h-[200px] md:h-[250px] flex justify-center items-center text-muted-foreground">Preparing chart...</div>
                            ) : clientDistributionData.length > 0 ? (
                                <ChartContainer config={clientChartConfig} className="w-full h-[220px] md:h-[300px]">
                                    <PieChart>
                                        <ChartTooltip content={<ChartTooltipContent nameKey="value" hideLabel />} />
                                        <Pie data={clientDistributionData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                                                {clientDistributionData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={clientChartColors[index % clientChartColors.length]} />
                                            ))}
                                        </Pie>
                                        <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }} />
                                    </PieChart>
                                </ChartContainer>
                            ) : (
                                <p className="text-center text-muted-foreground py-10">No employee data to display chart.</p>
                            )}
                            </CardContent>
                        </Card>
                    </div>
                )}
                {userRole !== 'client' && (
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
                                <div key={activity.id} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                     <Avatar className="hidden h-10 w-10 sm:flex">
                                        <AvatarFallback><UserPlus className="h-5 w-5" /></AvatarFallback>
                                    </Avatar>
                                    <div className="grid gap-1 sm:flex-1">
                                        <p className="text-sm font-medium leading-none">{activity.text}</p>
                                        <p className="text-sm text-muted-foreground">{activity.subtext}</p>
                                    </div>
                                    <Link href={`/employees/${activity.id}`} className="sm:ml-auto">
                                       <Button variant="ghost" size="sm" className="w-full sm:w-auto">View</Button>
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
                )}
            </div>

            {userRole === 'client' && (
                <Card>
                    <CardHeader>
                        <CardTitle>Live Attendance — Today</CardTitle>
                        <CardDescription>Showing latest check-ins/outs for {clientInfo?.clientName}.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {todayLogs.length === 0 ? (
                            <p className="text-center text-muted-foreground py-6">No attendance marked yet today.</p>
                        ) : (
                            <div className="space-y-3">
                                {todayLogs.slice(0, 12).map((l) => (
                                    <div key={l.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="min-w-0">
                                            <p className="font-medium truncate">{l.employeeName || l.employeeId}</p>
                                            <p className="text-xs text-muted-foreground truncate">{l.siteName}</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge variant={l.status === 'In' ? 'default' : 'secondary'}>{l.status}</Badge>
                                            <span className="text-xs text-muted-foreground">{getAttendanceReportedTime(l) ? format(getAttendanceReportedTime(l)!, 'hh:mm a') : ''}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
    const getAttendanceReportedTime = (log: any) => {
        if (log?.reportedAt?.toDate) return log.reportedAt.toDate();
        if (typeof log?.reportedAtClient === 'string') {
            const parsed = new Date(log.reportedAtClient);
            if (!Number.isNaN(parsed.getTime())) return parsed;
        }
        return log?.createdAt?.toDate ? log.createdAt.toDate() : null;
    };
