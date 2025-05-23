
import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK if not already initialized elsewhere
if (admin.apps.length === 0) {
  admin.initializeApp();
}

// Export your new function
export { processEmployeeCSV } from './processEmployeeCSV';

// Example: you might have other functions exported here
// export { anotherFunction } from './anotherFunction';
