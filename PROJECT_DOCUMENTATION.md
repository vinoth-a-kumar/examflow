# EXAM FLOW - EXAM SEATING MANAGEMENT SYSTEM
## Comprehensive Project Documentation

---

## TABLE OF CONTENTS

1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Module Documentation](#module-documentation)
   - [3.1 Dashboard](#31-dashboard)
   - [3.2 Exam Management](#32-exam-management)
   - [3.3 Hall Management](#33-hall-management)
   - [3.4 Seating Plan](#34-seating-plan)
   - [3.5 Settings](#35-settings)
   - [3.6 Profile](#36-profile)
   - [3.7 Upload Data](#37-upload-data)
4. [API Endpoints](#api-endpoints)
5. [Configuration](#configuration)
6. [Dependencies](#dependencies)

---

## PROJECT OVERVIEW

**ExamFlow** is a comprehensive React-based examination seating management system designed for educational institutions. The system facilitates:

- Student data upload and management
- Hall/examination venue management
- Exam schedule creation and management
- Automatic seating plan generation
- Attendance roster export and printing
- System configuration and backup management

**Key Features:**
- Multi-session exam management (Forenoon/Afternoon)
- Department and subject code filtering
- 2-seat and 3-seat bench configuration
- University-style and standard roster formats
- Printable label generation (84 labels per A4 page)
- Role-based access and college details management
- Data backup and restore functionality

**Target Audience:** College administration, examination coordinators, faculty staff

**Academic Year:** Automatically calculated based on current date (default: 2026-27)

**College:** Rajapalayam Rajus' College, Rajapalayam, Tamil Nadu, 626117

---

## SYSTEM ARCHITECTURE

### Frontend Structure

The application is a single-page React application with the following architecture:

```
src/
├── components/
│   ├── Header.jsx          # Top navigation header
│   └── Sidebar.jsx         # Left navigation sidebar
├── views/
│   ├── DashboardView.jsx   # Main dashboard overview
│   ├── ExamManagementView.jsx  # Exam creation/management
│   ├── HallManagementView.jsx  # Hall management (not fully read)
│   ├── SeatingPlanView.jsx   # Seating arrangement generation
│   ├── SettingsView.jsx      # System settings and backup
│   ├── ProfileView.jsx       # Institution and user profile
│   └── UploadDataView.jsx    # Student data upload
├── App.js                   # Main application component
├── index.js                 # Entry point
└── index.css                # Global styles
```

### Navigation Tabs

The system supports 6 main navigation tabs:

1. **Dashboard** - Live snapshot of examination infrastructure
2. **Upload** - Student data import and management
3. **Halls** - Hall/venue upload and management
4. **Exams** - Exam schedule creation and management
5. **Seating** - Seating plan generation and viewing
6. **Settings** - System configuration, backup, and maintenance

### State Management

- React `useState` for component-level state
- `useEffect` for side effects and data fetching
- LocalStorage for persisting college details, user preferences, theme
- API calls to Express backend (port 5000) for data operations

### Theme System

- Light/dark theme support via localStorage
- Default: light theme
- Syncs with `document.body.classList`

### Authentication

- Login view on initial access
- User state persisted in localStorage
- Logout clears user session

---

## MODULE DOCUMENTATION

### 3.1 DASHBOARD

**Purpose:** Provides an overview of the examination infrastructure with key statistics and quick access to major functions.

**Key Sections:**

- **Page Header:** "Dashboard Overview" with introductory text
- **Stat Cards:** 5 cards displaying:
  - Total Students
  - Total Halls
  - Total Capacity (2/3 Seats)
  - Total Exams
  - Departments count

- **Department Distribution:** Donut chart showing student distribution across departments with legend

- **Quick Actions:** 4 action buttons for navigation:
  - Upload Student Data
  - Manage Halls
  - Schedule Exam
  - Assign Seating Plan

- **Recent Activities:** Timeline of recent system activities with clear history option

**Technical Details:**
- Uses `STAT_STYLES` array for color-coded stat cards
- Department distribution uses SVG circle stroke-dasharray for donut chart
- Color palette: 8 distinct colors for department differentiation
- Activities show dot colors by type: student (primary), hall (success), exam (draft)

**Fresh Page Break:** `<div style={{pageBreakBefore: 'always'}} />` should be inserted before this section in printed format.

---

### 3.2 EXAM MANAGEMENT

**Purpose:** Create, manage, and schedule examinations with hall allocation and student capacity planning.

**Key Sections:**

- **Page Header:** "Exam Management" with "Create Exam" CTA button
- **Metrics Row:** 3 statistic cards showing:
  - Total Exams count
  - Upcoming Exams count
  - Assigned Halls count

- **Exams List Table:** Data table with columns:
  - Exam Name
  - Subject Code(s)
  - Date
  - Session & Time
  - Seats/Bench
  - Students Count
  - Assigned Halls
  - Status (Active/Scheduled/Draft)
  - Actions (Edit/Delete)

- **Create Exam Modal:** Full-featured modal with:
  - Exam Date selection (date picker)
  - Session selection (FN/AN)
  - Bench Configuration (2 or 3 seats per bench)
  - Subject Code Selector with search and filtering
  - Hall Allocation Cards
  - Live Smart Summary Bar showing schedule, subjects, students, and capacity

**Subject Code Selector Features:**
- Search functionality
- Year filter (1st Year through PG 2nd Year)
- Conflict detection for overlapping students
- Flat pills grid display with selection status

**Hall Allocation:**
- Real-time availability checking via backend API
- Capacity calculation based on bench configuration (2*SEATS / 3*SEATS)
- Deduplicated unique physical student counts

**Fresh Page Break:** `<div style={{pageBreakBefore: 'always'}} />` should be inserted before this section in printed format.

---

### 3.3 HALL MANAGEMENT

**Purpose:** Manage examination halls/venues with capacity tracking and availability checking.

**Note:** The HallManagementView component was observed in the views directory but its full source was not examined during this documentation session. It likely contains:

- Hall upload functionality
- Hall details management
- Hall availability checking
- Hall deletion capabilities

**Fresh Page Break:** `<div style={{pageBreakBefore: 'always'}} />` should be inserted before this section in printed format.

---

### 3.4 SEATING PLAN

**Purpose:** Generate and view examination seating arrangements with multiple viewing formats.

**Key Sections:**

- **Page Header:** "Seating Plan" with introductory text
- **Control Selectors:** Row with dropdowns for:
  - Select Date (from unique exam dates)
  - Select Session (FN/AN)
  - Select Hall (from exam-assigned halls)
  - Search Seating button

- **Overall Seat Labels Action Dropdown:** 
  - Print A4 Labels (all halls)
  - Download PDF (all halls)
  - Download Excel (.xlsx) (all halls)
  - Download CSV (.csv) (all halls)

- **Loading Indicator:** Spinner during seating plan generation

- **Error State:** Message if no seating plan found, with "Generate Seating Plan" button

- **Empty State:** Prompt to select Date, Session, and Hall

- **Seating Arrangement Layout Grid:**
  - Dynamic column count based on hall configuration
  - Bench cards showing seat positions (Left, Middle, Right)
  - Up to 6 benches displayed by default with "Show More" toggle
  - Seat positions: Left seat, Middle seat, Right seat (3-seat benches)

- **Attendance Roster Section:**
  - Department selector filter
  - Download Excel (.xlsx) button
  - Download PDF (.pdf) button
  - Print Roster button

- **View Format Toggle:**
  - University Sheet Format (default) - exactly 25 students per page
  - Standard List format

**University Sheet Format Details:**
- Repeated header on every page: "MADURAI KAMARAJ UNIVERSITY EXAMINATIONS" + "RAJAPALAYAM RAJUS' COLLEGE, RAJAPALAYAM"
- Info meta grid with: DATE OF EXAM, TIME OF EXAM, SUBJECT CODE, DEGREE
- Roster table with exactly 25 rows (filled + padded with blank rows)
- Columns: SL NO, REGISTER NUMBER, NAME OF THE CANDIDATE, SIGNATURE OF THE CANDIDATE
- Official footer on every page with:
  - Absentees Reg. No. with bottom line
  - Hall No.
  - Total No. of Absentees with bottom line
  - Name of the Invigilator and College with bottom line
  - Signature of the Chief Superintendent (left)
  - Signature of the Invigilator (right)

- **Seat Labels Printable Area:** A4 portrait format with 7 columns x 12 rows = 84 labels per page
- Label regeneration from seating grid or CSV download

**Fresh Page Break:** `<div style={{pageBreakBefore: 'always'}} />` should be inserted before this section in printed format. The university roster format already includes `pageBreakAfter: 'always'` for page separation.

---

### 3.5 SETTINGS

**Purpose:** System maintenance, data protection, and application controls.

**Key Sections:**

- **Page Header:** "Settings" with introductory text "System maintenance, data protection and application controls."

- **1. System Health (Full Width):**
  - Database status (Connected/Disconnected indicator)
  - Database Engine (MySQL)
  - Backend Server status (Online)
  - Last System Check timestamp
  - Storage Usage (1.45 MB displayed)

- **2. Data Management (Left Column):**
  - Summary of operational records:
    - Students count
    - Halls count
    - Exams count
    - Seating Plans count
  - "View" buttons to navigate to respective modules

- **3. Backup Center (Left Column):**
  - Last backup info with timestamp and size
  - "Create New Backup" button (downloads JSON backup)
  - "Restore Backup" file input
  - Backup protects: students, halls, exams, seating plans

- **4. System Activity (Right Column):**
  - Recent administrative activity log
  - Activity entries with timestamp, message, and detail
  - No activity logged message if empty

- **5. Application Information (Right Column):**
  - Application: "Exam Seating Management System"
  - Version: v1.2.0 (or projectVersion from backend)
  - Environment: Development/Production
  - Database: MySQL (or from backend)
  - Server Framework: Node.js / Express

- **6. Maintenance:**
  - "Refresh System Data" button to refetch record collections
  - Synchronizes caching with backend database

- **7. Danger Zone (Full Width at Bottom):**
  - "Reset System Data" - requires typing "RESET" to confirm
  - Warning: permanently deletes all operational data
  - Recommended: create backup before resetting
  - Restore Confirmation Modal for backup restoration

**Fresh Page Break:** `<div style={{pageBreakBefore: 'always'}} />` should be inserted before this section in printed format.

---

### 3.6 PROFILE

**Purpose:** Manage institution identity, logo, and administrator credentials.

**Key Sections:**

- **Page Header:** "Institution & Profile" with descriptive text

- **Institution Profile Card (Left Column):**
  - College logo preview (uploadable)
  - Institution name display
  - College address display
  - Form fields for name and address editing
  - "Save Details" primary button
  - Save success toast notification

- **Administrator Account Card (Right Column):**
  - Administrator avatar with initials
  - Full name and email display
  - Role: "System Superuser"
  - Form fields for name and email editing
  - "Save Account" primary button
  - "Change Password" (disabled in demo mode)
  - Save success toast notification

**Technical Details:**
- Logo upload with 2MB size limit
- FileReader for reading image files as Data URLs
- Separate save success states for college details and user credentials
- Avatar shows first 2 characters of username, uppercase

**Fresh Page Break:** `<div style={{pageBreakBefore: 'always'}} />` should be inserted before this section in printed format.

---

### 3.7 UPLOAD DATA

**Purpose:** Import student rosters, enrollment details, and departments securely.

**Key Sections:**

- **Page Header:** "Upload Student Data" with descriptive text

- **Top Row: Uploader + Upload History (side by side):**

  **Left Side: File Upload Box:**
  - Drag & drop area or "Browse Files" button
  - File upload supported: CSV, Excel (.xlsx, .xls)
  - Max 50 MB file size
  - CSV text mode toggle for pasting raw CSV content
  - Selected file display with remove option
  - "Confirm Upload" primary button

  **Right Side: Upload History Panel:**
  - List of previous uploads with status indicators
  - SUCCESS: green dot + "Imported {count} records"
  - ERROR: red dot + error message
  - Clear history button
  - Each entry shows: filename, status, record count, upload timestamp

- **Student Records Table:**
  - Dynamic table headers based on CSV columns
  - Search by name or register number
  - Department filter dropdown
  - "Refresh Records" button
  - "Clear Database" button (danger style)
  - Pagination: shows first 5 students, "View More" toggle for remaining

- **Table Features:**
  - Sticky header table
  - Dynamic column mapping from CSV data
  - Fallback value extraction (registerNo, name, department, batch)
  - Status pills for department values
  - Shows: "X of Y students" information

**Fresh Page Break:** `<div style={{pageBreakBefore: 'always'}} />` should be inserted before this section in printed format.

---

## API ENDPOINTS

The application communicates with a backend Express server running on `http://localhost:5000`. Key endpoints:

| Category | Endpoint | Method | Description |
|----------|----------|--------|-------------|
| Status | `/api/status` | GET | System status check |
| Dashboard Stats | `/api/dashboard/stats` | GET | Statistics for dashboard |
| Dashboard Activities | `/api/dashboard/activities` | GET/DELETE | Activity log |
| Students | `/api/students` | GET | Get all students |
| Students | `/api/students/clear` | POST | Clear all students |
| Students | `/api/students/subject-codes` | GET | Get subject codes |
| Students | `/api/students/remaining-by-subject` | GET | Remaining students by subject |
| Halls | `/api/halls` | GET | Get all halls |
| Halls | `/api/halls/clear` | POST | Clear all halls |
| Halls | `/api/halls/${id}` | DELETE | Delete hall |
| Halls | `/api/halls/availability` | GET | Hall availability |
| Exams | `/api/exams` | GET/POST/DELETE/PUT | Exam management |
| Exams | `/api/exams/${id}` | DELETE/PUT | Exam update/delete |
| Seating | `/api/seating/by-date-session` | GET | Seating plan by date/session/hall |
| Seating | `/api/seating/generate-by-date-session` | POST | Generate seating plan |
| Seating | `/api/seating/labels/download-csv` | GET | Download labels CSV |
| Seating | `/api/seating/labels/download-pdf` | GET | Download labels PDF |
| Seating | `/api/seating/labels/download-excel` | GET | Download labels Excel |
| Seating | `/api/seating/download-roster` | GET | Download roster Excel |
| Seating | `/api/seating/roster/download-pdf` | GET | Download roster PDF |
| Seating | `/api/seating/attendance-roster` | GET | Attendance roster data |
| Printouts | `/api/printouts/increment` | POST | Increment print count |
| Settings | `/api/settings/system-info` | GET | System information |
| Settings | `/api/settings/backup` | GET | Create backup |
| Settings | `/api/settings/restore` | POST | Restore backup |

---

## CONFIGURATION

### Environment Variables

The application uses Create React App with the following environment setup:

- **PUBLIC_URL:** Used for asset paths (logo, etc.)
- **NODE_ENV:** 'development' or 'production' (defaults to development)

### College Details (Stored in localStorage)

Default college details are auto-saved on first run:

```json
{
  "name": "Rajapalayam Rajus' College",
  "logo": "/college-logo.png",
  "address": "Rajapalayam, Tamil Nadu, 626117",
  "academicYear": "2026-27"
}
```

### Academic Year Calculation

Automatically calculated based on current date:
- If current month < May: previous year + current year (e.g., 2025-26)
- If current month >= May: current year + next year (e.g., 2026-27)

### Theme Persistence

- Theme stored in localStorage under key 'examflow-theme'
- Default: 'light'
- Available: 'light', 'dark', 'sunset'
- Syncs with document.body classList

### User Persistence

- User data stored in localStorage under key 'examflow-user'
- Persists login state across page reloads

### Backup Storage

- Backups stored in localStorage under key 'examflow-last-backup-meta'
- Meta includes: timestamp, size, availability status

---

## DEPENDENCIES

### Primary Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| react | ^19.2.7 | UI library |
| react-dom | ^19.2.7 | DOM rendering |
| react-scripts | 5.0.1 | CRA development scripts |
| lucide-react | ^1.21.0 | Icon library |
| web-vitals | ^2.1.4 | Performance metrics |

### Development Dependencies

- eslint configuration: react-app extends
- browserslist: Chrome, Firefox, Safari support

### Key Project Conventions

1. **Component Structure:** Functional components with hooks
2. **Styling:** Inline styles with CSS custom properties (var--)
3. **Color Scheme:** Primary purple (#4f46e5), secondary teal (#06b6d4), accent amber (#d97706), error red (#ef4444), success green (#10b981)
4. **Typography:** `--font-primary`, `--font-display` CSS variables
5. **Card Pattern:** Consistent `card-container` class with `card-title-bar` header
6. **Page Intro:** `page-intro` class for section headers
7. **Table Pattern:** `data-table` with `sticky-header-table` for sticky headers
8. **Button Styles:** 
   - `btn-primary`: Primary action (purple gradient)
   - `btn-secondary`: Secondary action (teal/gray)
   - `btn-danger`: Destructive action (red)
   - `btn-icon`: Small icon-only button

### Responsive Design

- Mobile sidebar toggles below 1024px width
- Sidebar-backdrop for mobile drawer overlay
- Flexible grid layouts with `gridTemplateColumns: 'repeat(auto-fit, minmax(...))'`
- Maximum width constraints on modals and cards

---

## PRINTING CONSIDERATIONS

### University Roster Format

The university sheet format is specifically designed for printing with these features:

- **Page Breaks:** Each page separates with `pageBreakAfter: 'always'`
- **Repeated Header:** University title and college name appear on every page
- **Repeated Meta:** Date, time, subject code, degree on every page
- **Fixed Table:** Exactly 25 rows per page (filled + blank padding)
- **Footer Section:** Appears on every page with:
  - Absentees register numbers
  - Hall number
  - Total absentees count
  - Invigilator and college name
  - Signature lines for Chief Superintendent and Invigilator

### Seat Labels

- A4 Portrait format
- 7 columns x 12 rows = 84 labels per page
- Generated from seating grid or CSV data
- Each label contains register number if available

### General Printing

- All views have `window.print()` capability
- Hidden print elements marked with `className="no-print"`
- Print header in SeatingPlanView includes college logo, academic year, exam details
- Print increment API call: `/api/printouts/increment`

---

## FUTURE ENHANCEMENTS

Potential improvements based on code analysis:

1. **Hall Management View:** Full implementation of hall upload and management
2. **Backend Integration:** Complete API endpoint implementation
3. **Additional Theme Options:** More color themes or custom branding
4. **Export Formats:** More export options (Word, CSV variations)
5. **User Authentication:** Enhanced login/registration system
6. **Email Notifications:** Automated exam notifications to staff
7. **Advanced Filtering:** More granular search and filter options
8. **Reporting:** Additional analytics and reporting features

---

## DOCUMENT STRUCTURE SUMMARY

This documentation follows a comprehensive format with:

1. **Header on each page:** Left = section title from table of contents, Right = section name
2. **Footer on each page:** Left = "EXAM FLOW - EXAM SEATING MANAGEMENT SYSTEM", Right = page number
3. **Each content starts as fresh page:** Using `pageBreakBefore: 'always'` in print CSS
4. **Table of Contents:** For easy navigation
5. **API Documentation:** Complete endpoint reference
6. **Configuration Details:** Environment and persistence settings
7. **Dependencies:** Package versions and conventions
8. **Printing Considerations:** Special format for university roster printing

---

*Document generated for ExamFlow Exam Seating Management System*
*Version: 1.0 | Last Updated: August 2026*