"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, or, query, where } from "firebase/firestore";
import type { ManagedSite } from "@/types/location";
import { siteBelongsToClient, sortSitesByName } from "@/lib/sites/site-directory";

export function useSites(clientId?: string, clientName?: string) {
  const [sites, setSites] = useState<ManagedSite[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Reports only need the selected client's sites. Query that scope in
    // Firestore instead of subscribing to every site and filtering locally.
    // Admin screens without a client scope retain the full directory.
    const sitesQuery = clientId && clientName
      ? query(
          collection(db, "sites"),
          or(where("clientId", "==", clientId), where("clientName", "==", clientName)),
        )
      : clientId
        ? query(collection(db, "sites"), where("clientId", "==", clientId))
      : clientName
        ? query(collection(db, "sites"), where("clientName", "==", clientName))
        : collection(db, "sites");
    const unsubscribe = onSnapshot(
      sitesQuery,
      (snapshot) => {
        const nextSites = snapshot.docs
          .map((doc) => {
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
              dutyPoints: Array.isArray(data.dutyPoints) ? data.dutyPoints : [],
            } as ManagedSite;
          })
          .filter((site) => {
            if (!clientId && !clientName) return true;
            return siteBelongsToClient(site, clientId, clientName);
          });

        setSites(sortSitesByName(nextSites));
        setIsLoading(false);
      },
      () => {
        setSites([]);
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [clientId, clientName]);

  return { sites, isLoading };
}
