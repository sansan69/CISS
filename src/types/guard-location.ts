import { Timestamp } from "firebase/firestore";

export interface GuardLocation {
  employeeDocId: string;
  employeeId: string;
  guardName: string;
  siteId: string;
  siteName: string;
  clientName: string;
  employeeClientName?: string;
  siteClientName?: string;
  crossClientRelief?: boolean;
  district: string;
  lat: number;
  lng: number;
  accuracy: number;
  distanceFromSite?: number | null;
  isOutOfZone: boolean;
  status: "In" | "Out";
  updatedAt: Timestamp;
  attendanceId?: string | null;
  siteLat?: number | null;
  siteLng?: number | null;
  geofenceRadius?: number;
  batteryLevel?: number;
  speed?: number;
  bearing?: number;
}
