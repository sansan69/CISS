
"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, onSnapshot, orderBy, doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import Link from 'next/link';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, UserPlus, AlertCircle } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

interface WorkOrder {
    id: string;
    siteId: string;
    siteName: string;
    clientName: string;
    district: string;
    date: any;
    maleGuardsRequired: number;
    femaleGuardsRequired: number;
    totalManpower: number;
    assignedGuards: any;
}

interface Site {
    id: string;
    siteName: string;
    clientName: string;
    district: string;
}

export default function AssignGuardsPage() {
    const params = useParams();
    const router = useRouter();
    const siteId = params.siteId as string;

    const [site, setSite] = useState<Site | null>(null);
    const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [userRole, setUserRole] = useState<string | null>(null);
    const [assignedDistricts, setAssignedDistricts] = useState<string[]>([]);

    useEffect(() => {
        const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    const tokenResult = await user.getIdTokenResult();
                    const claims = tokenResult.claims;
                    setUserRole(claims.role as string || 'user');
                    setAssignedDistricts(claims.districts as string[] || []);
                } catch (e) {
                    setUserRole('user');
                    setAssignedDistricts([]);
                }
            } else {
                router.push('/admin-login');
            }
        });
        return () => unsubscribeAuth();
    }, [router]);

    useEffect(() => {
        if (!siteId || userRole === null) return;

        const fetchSiteAndWorkOrders = async () => {
            setIsLoading(true);
            setError(null);
            try {
                // Fetch site details
                const siteDocRef = doc(db, "sites", siteId);
                const siteDoc = await getDoc(siteDocRef);

                if (!siteDoc.exists()) {
                    throw new Error("Site not found.");
                }

                const siteData = { id: siteDoc.id, ...siteDoc.data() } as Site;
                
                // Security Check: Ensure field officer can only access sites in their districts
                if (userRole === 'fieldOfficer' && !assignedDistricts.includes(siteData.district)) {
                     throw new Error("You do not have permission to view this site's work orders.");
                }

                setSite(siteData);

                // Fetch work orders for this site
                const q = query(
                    collection(db, "workOrders"),
                    where("siteId", "==", siteId),
                    orderBy("date", "asc")
                );

                const unsubscribe = onSnapshot(q, (snapshot) => {
                    const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WorkOrder));
                    setWorkOrders(orders);
                    setIsLoading(false);
                }, (err) => {
                    console.error("Error fetching work orders:", err);
                    setError("Could not load work orders for this site.");
                    setIsLoading(false);
                });
                
                return unsubscribe;

            } catch (err: any) {
                setError(err.message);
                setIsLoading(false);
            }
        };

        fetchSiteAndWorkOrders();

    }, [siteId, userRole, assignedDistricts]);
    

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-40">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2">Loading Site Work Orders...</p>
            </div>
        );
    }
    
    if (error) {
         return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
                <Button asChild variant="secondary" className="mt-4">
                    <Link href="/work-orders"><ArrowLeft className="mr-2 h-4 w-4"/>Back to Work Orders</Link>
                </Button>
            </Alert>
         )
    }


    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center gap-4">
                 <Button variant="outline" size="sm" asChild>
                    <Link href="/work-orders">
                        <ArrowLeft className="mr-2 h-4 w-4"/>
                        Back to All Sites
                    </Link>
                </Button>
            </div>
            
             <Card>
                <CardHeader>
                    <CardTitle className="text-2xl">Guard Assignment for {site?.siteName}</CardTitle>
                    <CardDescription>
                        Assign guards for the upcoming shifts at <span className="font-semibold">{site?.clientName} - {site?.district}</span>.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {workOrders.length === 0 ? (
                        <p className="text-center text-muted-foreground py-10">No work orders found for this site.</p>
                    ) : (
                        <div className="space-y-4">
                           {workOrders.map(order => (
                                <div key={order.id} className="p-4 border rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                    <div>
                                        <p className="font-bold text-lg">{order.date.toDate().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                                            <span>Male Required: <Badge>{order.maleGuardsRequired}</Badge></span>
                                            <span>Female Required: <Badge>{order.femaleGuardsRequired}</Badge></span>
                                            <span>Total: <Badge variant="secondary">{order.totalManpower}</Badge></span>
                                        </div>
                                    </div>
                                    <Button disabled>
                                        <UserPlus className="mr-2 h-4 w-4" /> Assign
                                    </Button>
                                </div>
                           ))}
                        </div>
                    )}
                </CardContent>
            </Card>

        </div>
    )
}
