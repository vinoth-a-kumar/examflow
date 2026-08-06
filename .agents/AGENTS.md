# ExamFlow Project Guidelines & Rules

## 1. Strictly Dynamic Architecture (Zero Hardcoded Sample Data)

- **Sample Data Scope**: All student numbers, register number formats (`CA26001`, `CS26001`, etc.), department names, hall counts, student counts, bench counts, subject codes, exam dates, and page counts mentioned during conversations are **SAMPLE / TEST DATA ONLY**.
- **No Hardcoding**: Never hard-code student counts, department names, hall names, page limits, or register number patterns in any feature logic, seating allocation algorithm, attendance roster generator, or export endpoint.
- **Uploaded Data Drives Everything**: All counts, grouping, filtering, seating allocation, bench assignment, department discovery, attendance roster page breaking (e.g. 25/page), and seat label pagination (e.g. 84/page) MUST be computed dynamically from the user's uploaded Excel/CSV student data, hall allocations, and database records.
- **Unlimited Scalability**: System MUST dynamically handle any arbitrary volume of:
  - Students ($1 \dots 10,000+$)
  - Departments ($1 \dots 50+$)
  - Subject Codes ($1 \dots 100+$)
  - Halls ($1 \dots 50+$)
  - Benches & Seats per Bench
  - Exam Dates & Sessions (`FN` / `AN`)
  - Generated Attendance Roster Pages
  - Generated Seat Label Pages
