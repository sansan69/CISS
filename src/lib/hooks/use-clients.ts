"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, onSnapshot, where } from "firebase/firestore";
import {
  dedupeClientOptions,
  sortClientOptionsByActiveGuardCount,
} from "@/lib/client-options";

export interface ClientOption {
  id: string;
  name: string;
  activeGuardCount?: number;
}

interface UseClientsOptions {
  sortByActiveGuardCount?: boolean;
}

export function useClients({ sortByActiveGuardCount = false }: UseClientsOptions = {}) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let clientRows: ClientOption[] = [];
    let activeGuardCountByClient = new Map<string, number>();
    let clientsLoaded = false;
    let activeGuardsLoaded = !sortByActiveGuardCount;

    const publish = () => {
      if (!clientsLoaded || !activeGuardsLoaded) {
        return;
      }

      const clientsWithCounts = sortByActiveGuardCount
        ? clientRows.map((client) => ({
            ...client,
            activeGuardCount: activeGuardCountByClient.get(client.name.toLowerCase()) ?? 0,
          }))
        : clientRows;
      const dedupedClients = dedupeClientOptions(clientsWithCounts);

      setClients(
        sortByActiveGuardCount
          ? sortClientOptionsByActiveGuardCount(dedupedClients)
          : dedupedClients,
      );
      setIsLoading(false);
    };

    const clientsQuery = query(collection(db, "clients"), orderBy("name", "asc"));
    const unsubscribeClients = onSnapshot(
      clientsQuery,
      (snapshot) => {
        clientRows = snapshot.docs.map((doc) => {
          const data = doc.data() as { name?: string; clientName?: string };
          return {
            id: doc.id,
            name: (data.name || data.clientName || "").trim(),
          };
        });
        clientsLoaded = true;
        publish();
      },
      () => {
        clientRows = [];
        clientsLoaded = true;
        publish();
      },
    );

    let unsubscribeActiveGuards: () => void = () => undefined;
    if (sortByActiveGuardCount) {
      const activeGuardsQuery = query(
        collection(db, "employees"),
        where("status", "==", "Active"),
      );
      unsubscribeActiveGuards = onSnapshot(
        activeGuardsQuery,
        (snapshot) => {
          activeGuardCountByClient = new Map<string, number>();
          snapshot.docs.forEach((doc) => {
            const clientName = (doc.data() as { clientName?: unknown }).clientName;
            if (typeof clientName !== "string" || !clientName.trim()) {
              return;
            }

            const key = clientName.trim().toLowerCase();
            activeGuardCountByClient.set(key, (activeGuardCountByClient.get(key) ?? 0) + 1);
          });
          activeGuardsLoaded = true;
          publish();
        },
        () => {
          activeGuardCountByClient = new Map<string, number>();
          activeGuardsLoaded = true;
          publish();
        },
      );
    }

    return () => {
      unsubscribeClients();
      unsubscribeActiveGuards();
    };
  }, [sortByActiveGuardCount]);

  return { clients, isLoading };
}
