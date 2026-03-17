"use client";

import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';

interface AuthContextValue {
  user: User | null;
  userRole: string | null;
  assignedDistricts: string[];
  clientInfo: { clientId: string; clientName: string } | null;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  userRole: null,
  assignedDistricts: [],
  clientInfo: null,
});

export function useAppAuth() {
  return useContext(AuthContext);
}
