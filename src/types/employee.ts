
export interface Employee {
  id: string; // Firestore document ID
  employeeId: string; // Generated CISS Employee ID like CLIENT/FY/###
  clientName: string;
  resourceIdNumber?: string;
  firstName: string;
  lastName: string;
  fullName: string; // Combined for convenience, can be derived or stored
  dateOfBirth: any; // Firebase Timestamp or ISO string
  gender: 'Male' | 'Female' | 'Other';
  fatherName: string;
  motherName: string;
  maritalStatus: 'Married' | 'Unmarried';
  spouseName?: string;
  district: string;
  panNumber?: string;
  
  // New Identity Proof Fields
  identityProofType?: string;
  identityProofNumber?: string;
  identityProofUrlFront?: string;
  identityProofUrlBack?: string;

  // New Address Proof Fields
  addressProofType?: string;
  addressProofNumber?: string;
  addressProofUrlFront?: string;
  addressProofUrlBack?: string;

  // New Signature Field
  signatureUrl?: string;

  epfUanNumber?: string;
  esicNumber?: string;
  bankAccountNumber: string;
  ifscCode: string;
  bankName: string;
  fullAddress: string;
  emailAddress: string;
  phoneNumber: string;
  profilePictureUrl?: string;
  
  // Legacy ID proof fields (can be phased out)
  idProofType?: string; 
  idProofNumber?: string;
  idProofDocumentUrl?: string;
  idProofDocumentUrlFront?: string;
  idProofDocumentUrlBack?: string;
  
  bankPassbookStatementUrl?: string;
  policeClearanceCertificateUrl?: string;
  joiningDate: any; // Firebase Timestamp or ISO string
  status: 'Active' | 'Inactive' | 'OnLeave' | 'Exited';
  qrCodeUrl?: string;
  exitDate?: any; // Firebase Timestamp or ISO string, for 'Exited' status
  createdAt: any; // Firestore Timestamp
  updatedAt: any; // Firestore Timestamp
  searchableFields?: string[];

  // Fields from previous mock, to be phased out or mapped
  department?: string;
}

// Mock data for development - update with new fields
export const mockEmployees: Employee[] = [
  {
    id: 'mock1',
    employeeId: 'TCS/2024-25/001',
    clientName: 'TCS',
    firstName: 'Aarav',
    lastName: 'Sharma',
    fullName: 'Aarav Sharma',
    dateOfBirth: '1990-05-15T00:00:00.000Z',
    gender: 'Male',
    fatherName: 'Ramesh Sharma',
    motherName: 'Sunita Sharma',
    maritalStatus: 'Married',
    spouseName: 'Priya Sharma',
    district: 'Thiruvananthapuram', 
    panNumber: 'ABCDE1234F',
    identityProofType: 'PAN Card',
    identityProofNumber: 'ABCDE1234F',
    addressProofType: 'Aadhar Card',
    addressProofNumber: '1234 5678 9012',
    epfUanNumber: '100123456789',
    esicNumber: '2001234567',
    bankAccountNumber: '001234567890',
    ifscCode: 'HDFC0000123',
    bankName: 'HDFC Bank',
    fullAddress: '123 MG Road, Thiruvananthapuram, Kerala',
    emailAddress: 'aarav.sharma@example.com',
    phoneNumber: '9876543210',
    profilePictureUrl: 'https://placehold.co/150x150.png',
    identityProofUrlFront: 'https://placehold.co/300x200.png',
    identityProofUrlBack: 'https://placehold.co/300x200.png',
    addressProofUrlFront: 'https://placehold.co/300x200.png',
    addressProofUrlBack: 'https://placehold.co/300x200.png',
    signatureUrl: 'https://placehold.co/200x100.png',
    bankPassbookStatementUrl: 'https://placehold.co/300x200.png',
    joiningDate: '2022-01-10T00:00:00.000Z',
    status: 'Active',
    qrCodeUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=MOCK_QR_AARAV',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    department: 'IT',
  },
];
