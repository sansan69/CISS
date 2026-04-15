import { NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';

interface SiteOption {
  id: string;
  siteName: string;
  clientName: string;
  clientId: string;
  district: string;
  geofenceRadiusMeters: number;
  strictGeofence: boolean;
  shiftMode: string;
  shiftPattern: string | null;
  shiftTemplates: unknown[];
  sourceCollection: 'sites' | 'clientLocations';
}

export async function GET() {
  try {
    // Fetch all sites that are active
    const sitesSnapshot = await db.collection('sites').get();
    
    const sites: SiteOption[] = sitesSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        siteName: data.siteName || '',
        clientName: data.clientName || '',
        clientId: data.clientId || '',
        district: data.district || '',
        geofenceRadiusMeters: data.geofenceRadiusMeters || 150,
        strictGeofence: data.strictGeofence || false,
        shiftMode: data.shiftMode || 'none',
        shiftPattern: data.shiftPattern || null,
        shiftTemplates: data.shiftTemplates || [],
        sourceCollection: 'sites',
      };
    });

    // Also fetch clientLocations
    const locationsSnapshot = await db.collection('clientLocations').get();
    
    const locations: SiteOption[] = locationsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        siteName: data.locationName || data.name || '',
        clientName: data.clientName || '',
        clientId: data.clientId || '',
        district: data.district || '',
        geofenceRadiusMeters: data.geofenceRadiusMeters || 150,
        strictGeofence: data.strictGeofence || false,
        shiftMode: 'none',
        shiftPattern: null,
        shiftTemplates: [],
        sourceCollection: 'clientLocations',
      };
    });

    // Combine and deduplicate by ID
    const allOptions: SiteOption[] = [...sites];
    locations.forEach(loc => {
      if (!allOptions.find(o => o.id === loc.id)) {
        allOptions.push(loc);
      }
    });

    return NextResponse.json({ options: allOptions });
  } catch (error) {
    console.error('Error loading duty centers:', error);
    return NextResponse.json(
      { error: 'Could not load duty centers.' },
      { status: 500 }
    );
  }
}