
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
  
  // Educational Qualification
  educationalQualification?: 'Primary School' | 'High School' | 'Diploma' | 'Graduation' | 'Post Graduation' | 'Doctorate' | 'Any Other Qualification';
  otherQualification?: string;

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
    educationalQualification: 'Graduation',
    identityProofType: 'PAN Card',
    identityProofNumber: 'ABCDE1234F',
    addressProofType: 'Aadhar Card',
    addressProofNumber: '123456789012',
    epfUanNumber: '100123456789',
    esicNumber: '2001234567',
    bankAccountNumber: '001234567890',
    ifscCode: 'HDFC0000123',
    bankName: 'HDFC Bank',
    fullAddress: '123 MG Road, Thiruvananthapuram, Kerala, 695001',
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
  {
    id: 'mock2',
    employeeId: 'WIPRO/2023-24/102',
    clientName: 'WIPRO',
    firstName: 'Isha',
    lastName: 'Verma',
    fullName: 'Isha Verma',
    dateOfBirth: '1995-11-20T00:00:00.000Z',
    gender: 'Female',
    fatherName: 'Anil Verma',
    motherName: 'Meena Verma',
    maritalStatus: 'Unmarried',
    district: 'Ernakulam',
    panNumber: 'FGHIJ5678K',
    educationalQualification: 'High School',
    identityProofType: 'Aadhar Card',
    identityProofNumber: '234567890123',
    addressProofType: 'Voter ID',
    addressProofNumber: 'KLJ9876543',
    bankAccountNumber: '112345678901',
    ifscCode: 'ICIC0000234',
    bankName: 'ICICI Bank',
    fullAddress: '456 Park Avenue, Ernakulam, Kerala, 682001',
    emailAddress: 'isha.verma@example.com',
    phoneNumber: '9123456780',
    profilePictureUrl: 'https://placehold.co/150x150.png',
    joiningDate: '2023-03-15T00:00:00.000Z',
    status: 'Active',
    qrCodeUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=MOCK_QR_ISHA',
    createdAt: new Date(new Date().setDate(new Date().getDate() - 50)).toISOString(),
    updatedAt: new Date().toISOString(),
    department: 'Security',
  },
  {
    id: 'mock3',
    employeeId: 'INFOSYS/2024-25/033',
    clientName: 'INFOSYS',
    firstName: 'Rohan',
    lastName: 'Nair',
    fullName: 'Rohan Nair',
    dateOfBirth: '1988-02-01T00:00:00.000Z',
    gender: 'Male',
    fatherName: 'Suresh Nair',
    motherName: 'Latha Nair',
    maritalStatus: 'Married',
    spouseName: 'Anjali Nair',
    district: 'Kozhikode',
    panNumber: 'KLMNO9012L',
    identityProofType: 'Passport',
    identityProofNumber: 'M1234567',
    addressProofType: 'Driving License',
    addressProofNumber: 'KL-11 20100012345',
    bankAccountNumber: '223456789012',
    ifscCode: 'SBIN0000456',
    bankName: 'State Bank of India',
    fullAddress: '789 Beach Road, Kozhikode, Kerala, 673001',
    emailAddress: 'rohan.nair@example.com',
    phoneNumber: '9988776655',
    profilePictureUrl: 'https://placehold.co/150x150.png',
    joiningDate: '2021-07-20T00:00:00.000Z',
    status: 'Inactive',
    qrCodeUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=MOCK_QR_ROHAN',
    createdAt: new Date(new Date().setDate(new Date().getDate() - 300)).toISOString(),
    updatedAt: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString(),
    department: 'Facilities',
  },
   {
    id: 'mock4',
    employeeId: 'TCS/2023-24/214',
    clientName: 'TCS',
    firstName: 'Priya',
    lastName: 'Menon',
    fullName: 'Priya Menon',
    dateOfBirth: '1998-09-12T00:00:00.000Z',
    gender: 'Female',
    fatherName: 'Gopi Menon',
    motherName: 'Radha Menon',
    maritalStatus: 'Unmarried',
    district: 'Thrissur',
    bankAccountNumber: '334567890123',
    ifscCode: 'FDRL0001234',
    bankName: 'Federal Bank',
    fullAddress: '101 Swaraj Round, Thrissur, Kerala, 680001',
    emailAddress: 'priya.menon@example.com',
    phoneNumber: '9000011111',
    status: 'OnLeave',
    joiningDate: '2023-11-01T00:00:00.000Z',
    qrCodeUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=MOCK_QR_PRIYA',
    createdAt: new Date(new Date().setDate(new Date().getDate() - 150)).toISOString(),
    updatedAt: new Date(new Date().setDate(new Date().getDate() - 10)).toISOString(),
    department: 'Security',
  },
  {
    id: 'mock5',
    employeeId: 'WIPRO/2022-23/005',
    clientName: 'WIPRO',
    firstName: 'Vikram',
    lastName: 'Singh',
    fullName: 'Vikram Singh',
    dateOfBirth: '1985-12-30T00:00:00.000Z',
    gender: 'Male',
    fatherName: 'Raj Singh',
    motherName: 'Kaur Singh',
    maritalStatus: 'Married',
    spouseName: 'Simran Singh',
    district: 'Kochi',
    identityProofType: 'Aadhar Card',
    identityProofNumber: '987654321098',
    bankAccountNumber: '445678901234',
    ifscCode: 'UTIB0000567',
    bankName: 'Axis Bank',
    fullAddress: '22 MG Road, Kochi, Kerala, 682016',
    emailAddress: 'vikram.singh@example.com',
    phoneNumber: '9223344556',
    status: 'Exited',
    joiningDate: '2022-02-01T00:00:00.000Z',
    exitDate: '2024-01-15T00:00:00.000Z',
    qrCodeUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=MOCK_QR_VIKRAM',
    createdAt: new Date(new Date().setDate(new Date().getDate() - 700)).toISOString(),
    updatedAt: new Date(new Date().setDate(new Date().getDate() - 90)).toISOString(),
    department: 'Admin',
  },
];
