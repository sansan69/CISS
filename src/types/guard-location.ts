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
  accuracyLimit?: number;
  gpsReliable?: boolean;
  distanceFromSite?: number | null;
  zoneStatus?: "in_zone" | "out_of_zone" | "poor_accuracy";
  isOutOfZone: boolean;
  status: "In" | "Out";
  updatedAt: Timestamp | null;
  serverReceivedAt?: Timestamp | null;
  clientCapturedAt?: Timestamp | null;
  attendanceSessionId?: string | null;
  attendanceId?: string | null;
  siteLat?: number | null;
  siteLng?: number | null;
  geofenceRadius?: number;
  batteryLevel?: number;
  speed?: number;
  bearing?: number;
}
