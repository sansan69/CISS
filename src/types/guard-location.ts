import { Timestamp } from "firebase/firestore";

export interface GuardLocation {
  employeeId: string;
  guardName: string;
  siteId: string;
  siteName: string;
  clientName: string;
  district: string;
  lat: number;
  lng: number;
  accuracy: number;
  isOutOfZone: boolean;
  status: "In" | "Out";
  updatedAt: Timestamp;
  attendanceId?: string;
  siteLat?: number;
  siteLng?: number;
  geofenceRadius?: number;
}
