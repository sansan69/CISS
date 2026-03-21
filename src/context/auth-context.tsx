"use client";

import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';

interface AuthContextValue {
  user: User | null;
  userRole: string | null;
  assignedDistricts: string[];
  clientInfo: { clientId: string; clientName: string } | null;
  stateCode: string | null;      // e.g. 'KL', 'MH'
  isSuperAdmin: boolean;          // true if role === 'superAdmin'
  employeeId?: string;
  employeeDocId?: string;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  userRole: null,
  assignedDistricts: [],
  clientInfo: null,
  stateCode: null,
  isSuperAdmin: false,
  employeeId: undefined,
  employeeDocId: undefined,
});

export function useAppAuth() {
  return useContext(AuthContext);
}
