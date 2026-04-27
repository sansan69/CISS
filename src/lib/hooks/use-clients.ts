"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { dedupeClientOptions } from "@/lib/client-options";

export interface ClientOption {
  id: string;
  name: string;
}

export function useClients() {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "clients"), orderBy("name", "asc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const dedupedClients = dedupeClientOptions(
          snapshot.docs
            .map((doc) => {
              const data = doc.data() as { name?: string; clientName?: string };
              return {
                id: doc.id,
                name: (data.name || data.clientName || "").trim(),
              };
            }),
        );

        setClients(dedupedClients);
        setIsLoading(false);
      },
      () => {
        setClients([]);
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  return { clients, isLoading };
}
