Query Firestore for CISS Workforce data.

Arguments: $ARGUMENTS (e.g., "employees where role = guard" or "attendanceLogs for 2025-01")

Steps:
1. Parse the natural language query into a Firestore collection and filters
2. Use Firebase MCP tools to query the collection
3. Present results in a readable format

Common collections: employees, attendanceLogs, clients, sites, payrollCycles, payrollEntries, clientWageConfig, users

Remember:
- Use `employeeDocId` (Firestore doc ID) not `employeeId` for attendance queries
- `attendanceDate` is a `YYYY-MM-DD` string
- Use `mcp__firebase__firestore_query_collection` for filtered queries
- Use `mcp__firebase__firestore_list_documents` for listing all docs