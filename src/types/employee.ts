
export interface Employee {
  id: string;
  employeeId: string;
  fullName: string;
  dateOfBirth: string;
  gender: 'Male' | 'Female' | 'Other';
  fatherName: string;
  motherName: string;
  maritalStatus: 'Single' | 'Married' | 'Divorced' | 'Widowed';
  nationality: string;
  religion?: string;
  bloodGroup?: string;
  presentAddress: string;
  permanentAddress: string;
  mobileNumber: string;
  alternateMobile?: string;
  emailId: string;
  aadharNumber: string;
  panNumber: string;
  uanNumber?: string;
  esicNumber?: string;
  pfNumber?: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  branchName: string;
  profilePictureUrl?: string;
  idProofUrl?: string;
  bankPassbookUrl?: string;
  joiningDate: string;
  status: 'Active' | 'Inactive' | 'OnLeave';
  department?: string; // Added for filtering
  qrCodeUrl?: string;
}

// Mock data for development
export const mockEmployees: Employee[] = [
  {
    id: '1',
    employeeId: 'CISS001',
    fullName: 'Aarav Sharma',
    dateOfBirth: '1990-05-15',
    gender: 'Male',
    fatherName: 'Ramesh Sharma',
    motherName: 'Sunita Sharma',
    maritalStatus: 'Married',
    nationality: 'Indian',
    religion: 'Hindu',
    bloodGroup: 'O+',
    presentAddress: '123 MG Road, Bangalore, Karnataka',
    permanentAddress: '123 MG Road, Bangalore, Karnataka',
    mobileNumber: '9876543210',
    emailId: 'aarav.sharma@example.com',
    aadharNumber: '123456789012',
    panNumber: 'ABCDE1234F',
    uanNumber: '100123456789',
    esicNumber: '2001234567',
    pfNumber: 'BNGLR1234567000',
    bankName: 'HDFC Bank',
    accountNumber: '001234567890',
    ifscCode: 'HDFC0000123',
    branchName: 'Koramangala',
    profilePictureUrl: 'https://placehold.co/150x150.png',
    idProofUrl: 'https://placehold.co/300x200.png',
    bankPassbookUrl: 'https://placehold.co/300x200.png',
    joiningDate: '2022-01-10',
    status: 'Active',
    department: 'IT',
    qrCodeUrl: 'https://placehold.co/100x100.png',
  },
  {
    id: '2',
    employeeId: 'CISS002',
    fullName: 'Priya Patel',
    dateOfBirth: '1992-08-20',
    gender: 'Female',
    fatherName: 'Suresh Patel',
    motherName: 'Anita Patel',
    maritalStatus: 'Single',
    nationality: 'Indian',
    religion: 'Hindu',
    bloodGroup: 'A+',
    presentAddress: '456 Park Avenue, Mumbai, Maharashtra',
    permanentAddress: '789 Old Street, Ahmedabad, Gujarat',
    mobileNumber: '9876543211',
    emailId: 'priya.patel@example.com',
    aadharNumber: '234567890123',
    panNumber: 'FGHIJ5678K',
    bankName: 'ICICI Bank',
    accountNumber: '002345678901',
    ifscCode: 'ICIC0000456',
    branchName: 'Andheri',
    profilePictureUrl: 'https://placehold.co/150x150.png',
    joiningDate: '2021-11-05',
    status: 'Active',
    department: 'HR',
    qrCodeUrl: 'https://placehold.co/100x100.png',
  },
  {
    id: '3',
    employeeId: 'CISS003',
    fullName: 'Rohan Das',
    dateOfBirth: '1988-12-01',
    gender: 'Male',
    fatherName: 'Amit Das',
    motherName: 'Rekha Das',
    maritalStatus: 'Married',
    nationality: 'Indian',
    religion: 'Christian',
    bloodGroup: 'B-',
    presentAddress: '789 Lake View, Kolkata, West Bengal',
    permanentAddress: '789 Lake View, Kolkata, West Bengal',
    mobileNumber: '9876543212',
    emailId: 'rohan.das@example.com',
    aadharNumber: '345678901234',
    panNumber: 'KLMNO9012L',
    bankName: 'Axis Bank',
    accountNumber: '003456789012',
    ifscCode: 'AXIS0000789',
    branchName: 'Salt Lake',
    profilePictureUrl: 'https://placehold.co/150x150.png',
    joiningDate: '2023-03-15',
    status: 'Inactive',
    department: 'Operations',
    qrCodeUrl: 'https://placehold.co/100x100.png',
  },
];
