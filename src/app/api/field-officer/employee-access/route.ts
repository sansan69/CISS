import { recordEmployeeAccess } from '@/lib/server/employee-access-audit';
import { NextResponse } from 'next/server';
import { hasAdminAccess, hasFieldOfficerAccess, verifyRequestAuth } from '@/lib/server/auth';
import { requireActiveFieldOfficerProfile } from '@/lib/server/linked-profiles';
import { employeeMatchesAnyDistrict } from '@/lib/employees/visibility';
export const runtime = 'nodejs';
export async function POST(request: Request) {
 let actor;
 try { actor = await verifyRequestAuth(request); }
 catch { return NextResponse.json({error:'Sign in required.'}, {status:401}); }
 if (!hasAdminAccess(actor) && !hasFieldOfficerAccess(actor)) return NextResponse.json({error:'Access denied.'}, {status:403});
 let id: string;
 try {
   const body = await request.json();
   id = typeof body.employeeDocId === 'string' ? body.employeeDocId.trim() : '';
   if (!id || id.length > 256 || id.includes('/')) throw new Error();
 } catch { return NextResponse.json({error:'Valid employee ID required.'}, {status:400}); }
 try {
   const {db} = await import('@/lib/firebaseAdmin');
   const doc = await db.collection('employees').doc(id).get();
   if (!doc.exists) return NextResponse.json({error:'Employee unavailable.'}, {status:404});
   if (!hasAdminAccess(actor)) {
     const profile = await requireActiveFieldOfficerProfile(db, actor);
     if (!employeeMatchesAnyDistrict(doc.data()!, profile.assignedDistricts)) return NextResponse.json({error:'Access denied.'}, {status:403});
   }
   await recordEmployeeAccess(db, actor.uid, id);
   return NextResponse.json({success:true}, {headers:{'Cache-Control':'no-store, private'}});
 } catch { return NextResponse.json({error:'Could not record employee access.'}, {status:503}); }
}
