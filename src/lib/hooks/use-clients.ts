"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";

export interface ClientOption {
  id: string;
  name: string;
}

export function useClients() {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "clients"), orderBy("name", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setClients(
        snapshot.docs.map((doc) => ({
          id: doc.id,
          name: doc.data().name,
        }))
      );
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { clients, isLoading };
}