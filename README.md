# CISS Workforce - AI-Powered Employee Management System

## 1. Project Overview

This document outlines the requirements for building a comprehensive employee management and attendance tracking system called "CISS Workforce". The application will be a Progressive Web App (PWA) built with Next.js, React, ShadCN UI, and Tailwind CSS. The backend will be powered exclusively by Firebase (Firestore, Firebase Auth, and Firebase Storage).

The application serves two primary user roles:
1.  **Employees (Public Users):** Can enroll, view their own profile, and mark attendance.
2.  **Super Admins:** Can log in to a secure dashboard to manage employees, view analytics, and access settings.

---

## 2. Core Technologies

-   **Frontend:** Next.js (App Router), React, TypeScript
-   **UI:** ShadCN UI Components, Tailwind CSS
-   **Backend:** Firebase (Firestore, Auth, Storage)
-   **Deployment:** The frontend will be a static/SSR build, and any backend logic will be handled by Firebase Cloud Functions.

---

## 3. Key Features

### 3.1. Public-Facing Features (No Login Required)

#### 3.1.1. Landing Page (`/`)
-   **Purpose:** The main entry point for all users.
-   **UI:**
    -   Company Logo and Name ("CISS Workforce").
    -   A simple phone number input field for employees to log in or register.
    -   A "Continue" button.
    -   A prominent link/button for "Record Attendance".
    -   A less prominent link for "Admin Login".
-   **Logic:**
    -   User enters their 10-digit phone number.
    -   On "Continue", the app queries the `employees` collection in Firestore to see if the phone number exists.
    -   **If exists:** The user is redirected to their public profile page (`/profile/[employeeId]`).
    -   **If not exists:** The user is redirected to the enrollment form (`/enroll?phone=[phoneNumber]`), with the phone number pre-filled and disabled.

#### 3.1.2. Employee Enrollment Form (`/enroll`)
-   **Purpose:** A multi-step, user-friendly form for new employees to register themselves.
-   **UI:** A well-structured form divided into sections. All fields are required unless specified.
    -   **Client Information:** Joining Date, Client Name (dropdown populated from `clients` collection).
    -   **Personal Information:** Profile Picture (file upload or camera), First Name, Last Name, Father's Name, Mother's Name, Date of Birth, Gender (select), Marital Status (select), Spouse's Name (conditional).
    -   **Location & ID:** District (dropdown of Kerala districts), PAN Card, ID Proof Type (select: Aadhar, etc.), ID Proof Number, ID Proof Document (front/back, file upload/camera), EPF/UAN, ESIC Number.
    -   **Bank Details:** Account Number, IFSC Code, Bank Name, Bank Passbook/Statement copy (file upload/camera).
    -   **Contact Info:** Full Address, Email, Phone Number (pre-filled and disabled if coming from the landing page).
-   **Logic:**
    -   Uses `react-hook-form` and `zod` for robust validation.
    -   **Camera Access:** Provides an option to use the device camera for all file uploads. For documents, it should prefer the rear camera (`environment`).
    -   **File Handling:** All uploaded images (profile pic, documents) are compressed client-side before being uploaded to Firebase Storage to save space and bandwidth. Store files in a structured path, e.g., `employees/{phoneNumber}/profile.jpg`.
    -   **Submission:**
        1.  Generates a unique `employeeId` (e.g., `CISS/TCS/2024-25/001`).
        2.  Generates a QR code containing key employee details and uploads it as a Data URL to Firestore.
        3.  Uploads all files to Firebase Storage and gets their download URLs.
        4.  Creates a new document in the `employees` collection in Firestore with all form data and file URLs.
        5.  On success, redirects the user to their newly created profile page (`/profile/[newEmployeeId]`).

#### 3.1.3. Public Employee Profile (`/profile/[id]`)
-   **Purpose:** A read-only view of an employee's profile, accessible via a direct link.
-   **UI:**
    -   Clean, professional layout with employee's photo, name, and Employee ID prominently displayed.
    -   Tabbed interface for different sections: Personal, Employment, Bank, Identification, Documents & QR Code.
    -   Displays all information from the employee's Firestore document.
    -   The "Documents" tab shows links to view/download the files stored in Firebase Storage.

#### 3.1.4. Attendance Marking (`/attendance`)
-   **Purpose:** A dedicated page for marking attendance using a QR code, photo, and location.
-   **UI:**
    -   A large button to "Scan QR & Verify".
    -   Displays status indicators for: QR Scan (Not Scanned / Scanned: ID), Photo (No Photo / Captured), Location (Not Fetched / Fetched).
    -   When "Scan QR" is clicked, it should simulate a scan, capture a photo using the device's camera, and get the device's geolocation.
    -   Once all three are captured, "Mark IN" and "Mark OUT" buttons are enabled.
    -   Shows a log of the last 5 attendance records marked on that device.
-   **Logic:**
    -   This is a simplified, standalone feature for now. In the future, it would save attendance data to a new `attendance` collection in Firestore, linked to the employee's ID.

### 3.2. Admin Features (Login Required - `/app/*`)

#### 3.2.1. Admin Login (`/admin-login`)
-   **Purpose:** Secure login page for administrators.
-   **UI:** Simple form with Email and Password fields.
-   **Logic:**
    -   Uses Firebase Authentication (Email/Password provider).
    -   On successful login, the user is redirected to the Admin Dashboard (`/dashboard`).
    -   Shows clear error messages for incorrect credentials, user not found, etc.

#### 3.2.2. Admin Layout (`/app/layout.tsx`)
-   **Purpose:** A persistent layout for all admin pages.
-   **UI:**
    -   A collapsible sidebar navigation menu.
    -   The sidebar includes links to Dashboard, Employees (with sub-links for Directory and Enroll New), Attendance, and Settings.
    -   A header area.
    -   A user profile dropdown in the sidebar footer to show the logged-in admin's email and a "Log Out" button.
-   **Logic:**
    -   This is a protected route group. If a non-authenticated user tries to access any page under `/app`, they are redirected to `/admin-login`.

#### 3.2.3. Dashboard (`/dashboard`)
-   **Purpose:** Provide a high-level overview of the workforce.
-   **UI:**
    -   **Stat Cards:** Total Employees, Active, Inactive, On Leave.
    -   **Charts (using Recharts/ShadCN Charts):**
        -   A bar chart showing new hires over the last 6 months.
        -   A pie chart showing employee distribution by `clientName`.
-   **Logic:**
    -   All data is fetched live from Firestore.
    -   Stat cards use `getCountFromServer` for efficient counting.
    -   Charts query the `employees` collection and aggregate the data client-side.

#### 3.2.4. Employee Directory (`/employees`)
-   **Purpose:** A searchable and filterable list of all employees.
-   **UI:**
    -   A table displaying employees with columns: Employee Name (with photo), Employee ID, Client, Mobile, Status (as a badge).
    -   **Filtering:** Dropdown filters for Client, Status, and District.
    -   **Searching:** An input field to search by Employee ID.
    -   **Pagination:** "Next" and "Previous" buttons to navigate through the employee list.
    -   **Actions:** A dropdown menu (`...`) for each row with options:
        -   View Profile (`/employees/[id]`)
        -   Edit (`/employees/[id]?edit=true`)
        -   Change Status (Active, Inactive, Exited - shows a confirmation dialog).
        -   Delete (shows a confirmation dialog).
-   **Logic:**
    -   Implements server-side pagination and filtering using Firestore query cursors (`startAfter`, `limit`) for performance.
    -   Deleting an employee also deletes their associated files from Firebase Storage.

#### 3.2.5. Admin Employee Profile View (`/employees/[id]`)
-   **Purpose:** A comprehensive view of an employee's profile with editing capabilities for admins.
-   **UI:**
    -   Identical to the public profile view but includes an "Edit Profile" button.
    -   When in edit mode (`?edit=true`), the page transforms into the enrollment form, pre-filled with the employee's existing data.
-   **Logic:**
    -   Fetches employee data from Firestore.
    -   **Editing:** When changes are saved, it updates the existing Firestore document. It can also handle replacing uploaded files by deleting the old file from Storage and uploading the new one.
    -   **Admin Actions:** Allows regeneration of Employee ID and QR Code.

#### 3.2.6. Settings (`/settings/*`)
-   **Client Management (`/settings/client-management`):** A simple CRUD interface to add/delete client names in the `clients` collection.
-   **QR Management & Reports:** Placeholder pages linking to future functionality.

---

## 4. Firebase Schema

### `employees` collection
-   Document ID: Auto-generated
-   Fields: `employeeId`, `firstName`, `lastName`, `fullName`, `clientName`, `phoneNumber`, `emailAddress`, `status`, `joiningDate`, `profilePictureUrl`, etc. (all fields from the enrollment form).

### `clients` collection
-   Document ID: Auto-generated
-   Fields: `name` (string), `createdAt` (timestamp).

---

## 5. Implementation Notes

-   **State Management:** Use React's built-in state management (`useState`, `useContext`) where possible. For complex server state, `react-query` can be used.
-   **Styling:** Strictly use Tailwind CSS and ShadCN component styles. Adhere to the theme defined in `globals.css`.
-   **Error Handling:** Implement user-friendly error messages using the `Toast` component for all user actions (form submissions, logins, etc.). Use `error.js` and `loading.js` files within the App Router for better UX.
-   **PWA:** Ensure the application is installable and has basic offline capabilities via a service worker.
