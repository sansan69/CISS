"use client";

import { useState, useEffect, useMemo } from "react";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, onSnapshot, where } from "firebase/firestore";
import type { ManagedSite } from "@/types/location";

export function useSites(clientId?: string) {
  const [sites, setSites] = useState<ManagedSite[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let q = query(collection(db, "sites"), orderBy("siteName", "asc"));
    
    if (clientId) {
      q = query(collection(db, "sites"), where("clientId", "==", clientId), orderBy("siteName", "asc"));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSites(
        snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            clientId: data.clientId,
            clientName: data.clientName,
            siteName: data.siteName,
            siteAddress: data.siteAddress || data.address || "",
            district: data.district,
            geolocation: data.geolocation,
            geofenceRadiusMeters: data.geofenceRadiusMeters,
            strictGeofence: data.strictGeofence,
            coordinateStatus: data.coordinateStatus,
          } as ManagedSite;
        })
      );
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [clientId]);

  return { sites, isLoading };
}