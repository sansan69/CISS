
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
  idProofType: string;
  idProofNumber: string;
  epfUanNumber?: string;
  esicNumber?: string;
  bankAccountNumber: string;
  ifscCode: string;
  bankName: string;
  fullAddress: string;
  emailAddress: string;
  phoneNumber: string;
  profilePictureUrl?: string;
  idProofDocumentUrl?: string; // Legacy field for backwards compatibility
  idProofDocumentUrlFront?: string;
  idProofDocumentUrlBack?: string;
  bankPassbookStatementUrl?: string;
  joiningDate: any; // Firebase Timestamp or ISO string
  status: 'Active' | 'Inactive' | 'OnLeave' | 'Exited'; // Added 'Exited'
  qrCodeUrl?: string;
  exitDate?: any; // Firebase Timestamp or ISO string, for 'Exited' status
  createdAt: any; // Firestore Timestamp
  updatedAt: any; // Firestore Timestamp

  // Fields from previous mock, to be phased out or mapped
  department?: string; // May not be needed if clientName implies department or not used
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
    district: 'Thiruvananthapuram', // Changed for Kerala context
    panNumber: 'ABCDE1234F',
    idProofType: 'Aadhar Card',
    idProofNumber: '123456789012',
    epfUanNumber: '100123456789',
    esicNumber: '2001234567',
    bankAccountNumber: '001234567890',
    ifscCode: 'HDFC0000123',
    bankName: 'HDFC Bank',
    fullAddress: '123 MG Road, Thiruvananthapuram, Kerala',
    emailAddress: 'aarav.sharma@example.com',
    phoneNumber: '9876543210',
    profilePictureUrl: 'https://placehold.co/150x150.png',
    idProofDocumentUrlFront: 'https://placehold.co/300x200.png',
    idProofDocumentUrlBack: 'https://placehold.co/300x200.png',
    bankPassbookStatementUrl: 'https://placehold.co/300x200.png',
    joiningDate: '2022-01-10T00:00:00.000Z',
    status: 'Active',
    qrCodeUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=MOCK_QR_AARAV',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    department: 'IT',
  },
  {
    id: 'mock2',
    employeeId: 'WIPRO/2023-24/002',
    clientName: 'Wipro',
    firstName: 'Priya',
    lastName: 'Patel',
    fullName: 'Priya Patel',
    dateOfBirth: '1992-08-20T00:00:00.000Z',
    gender: 'Female',
    fatherName: 'Suresh Patel',
    motherName: 'Anita Patel',
    maritalStatus: 'Unmarried',
    district: 'Ernakulam', // Changed for Kerala context
    panNumber: 'FGHIJ5678K',
    idProofType: 'Voter ID',
    idProofNumber: '234567890123',
    bankAccountNumber: '002345678901',
    ifscCode: 'ICIC0000456',
    bankName: 'ICICI Bank',
    fullAddress: '456 Park Avenue, Kochi, Kerala',
    emailAddress: 'priya.patel@example.com',
    phoneNumber: '9876543211',
    profilePictureUrl: 'https://placehold.co/150x150.png',
    idProofDocumentUrlFront: 'https://placehold.co/300x200.png',
    idProofDocumentUrlBack: 'https://placehold.co/300x200.png',
    joiningDate: '2021-11-05T00:00:00.000Z',
    status: 'Active',
    qrCodeUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=MOCK_QR_PRIYA',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    department: 'HR',
  },
];
