# Story 9-UI: Production Error Monitoring Dashboard UI

Status: ready-for-dev

## Story

As an Operations team member or Manager,  
I want a comprehensive dashboard UI to monitor production errors in real-time,  
so that I can quickly identify, triage, and respond to errors across all monitored applications through an intuitive visual interface.

## Context

This story creates the **frontend UI** for the Production Error Monitoring Dashboard, consuming the backend APIs implemented in **Story 9-U-5**. The dashboard will be implemented in the **`dsf-dashboard`** repository at `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/` using React 19, TypeScript, and Tailwind CSS v4 with shadcn/ui components.

**Backend Dependencies** (Already Implemented):

- **Story 9-U-5**: Production Error Dashboard Backend APIs (`GET /api/v1/monitoring/errors/*`)
- **Story 10-U-1**: Socket.IO Real-Time Infrastructure (WebSocket gateway for live updates)
- **Story 9-U-3**: Automatic Fix Ticket Creation (ClickUp integration)
- **Story 9-U-4**: Error Context Extraction & Linking (deployment/commit data)

**Key Features**:

1. Error Overview Widget (metrics dashboard)
2. Filterable Error List Table (with pagination, sorting)
3. Error Detail Modal (full context view)
4. Real-Time Toast Notifications (Socket.IO)
5. Error Trend Chart (7-day rolling, by severity)
6. Application Health Heatmap (per-app status cards)
7. Bulk Actions (create tickets, acknowledge, export CSV)
8. RBAC-aware UI (hide/disable actions based on user role)

## Acceptance Criteria

### AC#1: Dashboard Page Layout & Navigation

**Given** I am authenticated with appropriate permissions  
**When** I navigate to `/production-errors`  
**Then** I should see:

- Page title: "Production Error Monitoring"
- Overview widget at the top
- Application health heatmap below overview
- Error trend chart in middle section
- Filterable error list table at the bottom
- Sidebar navigation item "Production Errors" with AlertTriangle icon

**Implementation**:

- Create `src/pages/ProductionErrorDashboardPage.tsx`
- Add route in `App.tsx` router config
- Update `Sidebar.tsx` with new menu item (icon: `AlertTriangle` from `lucide-react`)
- Use 3-column grid layout on desktop, single column on mobile

### AC#2: Error Overview Widget

**Given** production errors exist in the system  
**When** the overview widget loads  
**Then** I should see four metric cards displaying:

1. **Total Active Errors**: Count of errors without resolution (fix_ticket_id = null OR ticket not closed)
2. **New Errors (Last 24h)**: Count of errors created in last 24 hours
3. **Critical/High Errors**: Combined count of CRITICAL and HIGH severity errors
4. **Average Time to Resolution (MTTR)**: Mean time from error creation to fix ticket closure (in hours)

**And** each metric should have:

- Large numeric value (font-size: 2.5rem)
- Descriptive label below value
- Subtle background color (slate for total, blue for new, red/orange for critical/high, green for MTTR)
- Loading skeleton while data is fetching

**API Endpoint**:

- `GET /api/v1/monitoring/errors/overview`
- Response:
  ```json
  {
    "totalActive": 42,
    "new24h": 8,
    "criticalAndHigh": 12,
    "mttrHours": 6.5
  }
  ```

**Components**:

- `ErrorOverviewWidget.tsx` (parent container with 4 metric cards)
- `MetricCard.tsx` (reusable card component)
- Use shadcn/ui `Card`, `CardHeader`, `CardTitle`, `CardContent`
- Use `Skeleton` for loading states

### AC#3: Error List Table with Filtering

**Given** multiple errors exist with different attributes  
**When** I interact with the error list table  
**Then** I should be able to:

**Table Features**:

- **Columns**: Application, Error Type, Message (truncated to 60 chars), Severity, Occurred At (relative time), Affected Users, Status, Actions button
- **Filtering**:
  - Multi-select dropdown for Severity (options: CRITICAL, HIGH, MEDIUM, LOW)
  - Multi-select dropdown for Application (auto-populated from data)
  - Single-select dropdown for Status (options: Active, Ticket Created, In Progress, Resolved)
  - Date range picker (presets: Last 24h, Last 7 days, Last 30 days, Custom range)
- **Sorting**: Click column headers to sort (default: Severity DESC, then Occurred At DESC)
- **Pagination**: 20 rows per page, pagination controls at bottom
- **Row Selection**: Checkbox column for bulk actions

**API Endpoint**:

- `GET /api/v1/monitoring/errors?severity=CRITICAL,HIGH&application=api-service&status=Active&from=2026-02-01&to=2026-02-04&page=1&limit=20&sortBy=severity&sortOrder=desc`
- Response:
  ```json
  {
    "errors": [
      {
        "id": "error-uuid-123",
        "application": "api-service",
        "error_type": "TypeError",
        "message": "Cannot read property 'id' of undefined",
        "severity": "CRITICAL",
        "occurred_at": "2026-02-04T20:15:00Z",
        "affected_users": 15,
        "fix_ticket_id": "clickup-task-456",
        "fix_ticket_url": "https://app.clickup.com/t/456",
        "acknowledged_at": null
      }
    ],
    "total": 42,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
  ```

**Components**:

- `ErrorListTable.tsx` (main table component)
- `ErrorTableFilters.tsx` (filter toolbar component)
- Use shadcn/ui `Table`, `Select`, `Popover`, `Calendar`, `Checkbox`
- Use `react-table` or `@tanstack/react-table` for table state management

### AC#4: Error Detail Modal

**Given** I click on an error row in the table  
**When** the error detail modal opens  
**Then** I should see:

**Modal Sections**:

1. **Header**: Error Type badge, Severity badge (color-coded), Timestamp
2. **Error Info Section**:
   - Full error message (not truncated)
   - Formatted stack trace with syntax highlighting
3. **Deployment Context Section** (collapsible):
   - Deployment ID, Commit SHA (GitHub link), Branch name, Deployed At timestamp
4. **Related Commits Section** (collapsible):
   - List of up to 5 commits with: commit message, commit SHA (GitHub link), author, timestamp
5. **User Context Section** (collapsible):
   - Affected Users count
   - User IDs (anonymized: `user-abc123`)
   - Session IDs
   - User Agents
6. **Fix Ticket Section**:
   - ClickUp task URL (if fix_ticket_id exists): "View Ticket" button → opens ClickUp in new tab
   - OR "Create Fix Ticket" button (if fix_ticket_id is null) → calls `POST /api/v1/monitoring/errors/:id/create-ticket`
7. **Actions**:
   - "Mark as Acknowledged" button → calls `POST /api/v1/monitoring/errors/:id/acknowledge`
   - "Close" button

**API Endpoint**:

- `GET /api/v1/monitoring/errors/:id` (detailed view)
- Response:
  ```json
  {
    "id": "error-uuid-123",
    "application": "api-service",
    "error_type": "TypeError",
    "message": "...",
    "stack_trace": "...",
    "severity": "CRITICAL",
    "occurred_at": "2026-02-04T20:15:00Z",
    "affected_users": 15,
    "user_context": { "userIds": ["..."], "sessionIds": ["..."], "userAgents": ["..."] },
    "deployment": {
      "id": "deploy-789",
      "commit_sha": "abc123",
      "branch": "main",
      "deployed_at": "2026-02-04T18:00:00Z"
    },
    "related_commits": [
      { "sha": "abc123", "message": "Fix user auth", "author": "dev1", "timestamp": "..." }
    ],
    "fix_ticket_id": "clickup-task-456",
    "fix_ticket_url": "https://app.clickup.com/t/456",
    "acknowledged_at": null,
    "acknowledged_by": null
  }
  ```

**Components**:

- `ErrorDetailModal.tsx` (main modal component)
- Use shadcn/ui `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `Badge`, `Button`, `Collapsible`
- Use `react-syntax-highlighter` for stack trace formatting (theme: `vsDark` or `nord`)

### AC#5: Real-Time Error Notifications

**Given** the dashboard is open with an active Socket.IO connection  
**When** a new production error with severity CRITICAL or HIGH is created  
**Then**:

- A toast notification appears in the top-right corner with:
  - Title: `[CRITICAL] api-service` (severity + application)
  - Description: `TypeError: Cannot read property 'id' of undefined` (error type + truncated message)
  - Variant: `destructive` (red background)
  - Duration: 8 seconds
- The error overview widget counts update automatically
- The error list table prepends the new error (if filters match)
- The new row is highlighted with a fade-in animation for 3 seconds

**Socket.IO Integration**:

- Connect to Socket.IO server using `socket.io-client`
- Join room: `production_events`
- Listen for event: `error.created` with severity routing key (`error.critical` or `error.high`)
- Event payload:
  ```json
  {
    "id": "error-uuid-123",
    "application": "api-service",
    "error_type": "TypeError",
    "message": "...",
    "severity": "CRITICAL",
    "occurred_at": "2026-02-04T20:15:00Z"
  }
  ```

**Components & Hooks**:

- `useProductionErrorSocket()` custom hook (manages Socket.IO connection)
- Use shadcn/ui `Toast`, `ToastProvider`, `useToast()` hook
- Use `react-query` mutations to invalidate and refetch queries on new error event

### AC#6: Error Trend Chart (7-Day Rolling)

**Given** errors have been ingested over the past 7 days  
**When** I view the error trend chart  
**Then** I should see:

- Stacked area chart or multi-line chart with 4 series (CRITICAL, HIGH, MEDIUM, LOW)
- X-axis: Dates (format: "Mon 02/03", last 7 days including today)
- Y-axis: Error count
- Color coding: CRITICAL (red `#ef4444`), HIGH (orange `#f97316`), MEDIUM (yellow `#eab308`), LOW (blue `#3b82f6`)
- Tooltip on hover showing exact counts per severity for each day
- Optional toggle button: Switch between "By Severity" view (default) and "By Application" view

**API Endpoint**:

- `GET /api/v1/monitoring/errors/trends?days=7`
- Response:
  ```json
  {
    "dates": ["2026-01-29", "2026-01-30", ..., "2026-02-04"],
    "trendsBySeverity": {
      "CRITICAL": [2, 1, 0, 3, 1, 2, 1],
      "HIGH": [5, 3, 4, 6, 2, 5, 4],
      "MEDIUM": [12, 15, 10, 14, 13, 11, 10],
      "LOW": [8, 6, 9, 7, 5, 8, 6]
    }
  }
  ```

**Components**:

- `ErrorTrendChart.tsx`
- Use `recharts` library: `AreaChart` or `LineChart` with multiple `Area` or `Line` components
- Use shadcn/ui `Card` as container
- Use `Button` with `Group` icon for view toggle

### AC#7: Application Health Heatmap

**Given** multiple applications are being monitored  
**When** I view the application health heatmap  
**Then** I should see:

- Responsive card grid (1 column mobile, 2 columns tablet, 3-4 columns desktop)
- Each card represents one application with:
  - Application name (header, bold)
  - Error count (last 24h) with badge (e.g., "12 errors")
  - Health status indicator: colored dot or shield icon next to name
    - **Green** (`#22c55e`): 0 errors
    - **Yellow** (`#eab308`): 1-5 MEDIUM/LOW errors
    - **Orange** (`#f97316`): 1+ HIGH errors OR 6+ MEDIUM/LOW errors
    - **Red** (`#ef4444`): 1+ CRITICAL errors
  - Last error timestamp (relative: "2 hours ago" using `date-fns` or `dayjs`)
  - "View Details" link → filters error list table by this application name

**API Endpoint**:

- `GET /api/v1/monitoring/applications/health`
- Response:
  ```json
  [
    {
      "application": "api-service",
      "errorCount24h": 12,
      "criticalCount": 1,
      "highCount": 3,
      "mediumCount": 8,
      "lowCount": 0,
      "healthStatus": "RED",
      "lastErrorAt": "2026-02-04T20:15:00Z"
    },
    ...
  ]
  ```

**Components**:

- `ApplicationHealthHeatmap.tsx` (grid container)
- `AppHealthCard.tsx` (individual card component)
- Use shadcn/ui `Card`, `Badge`, `Link` (or `Button` variant `link`)
- Use `lucide-react` icons: `ShieldCheck` (green), `ShieldAlert` (yellow/orange), `ShieldX` (red)

### AC#8: Bulk Actions & Quick Operations

**Given** I have selected one or more error rows using checkboxes  
**When** the bulk actions toolbar appears  
**Then** I should be able to:

1. **Create Fix Tickets**: Bulk create ClickUp tickets for selected errors (button disabled if any selected error already has fix_ticket_id)
2. **Mark as Acknowledged**: Update `acknowledged_at` and `acknowledged_by` for selected errors
3. **Export to CSV**: Download selected errors as CSV file

**And** each action should:

- Show a confirmation dialog before execution (shadcn/ui `AlertDialog`)
- Display a loading spinner during API call
- Show success toast message on completion (e.g., "Created 3 fix tickets successfully")
- Show error toast if any failure occurs
- Clear row selection after successful action
- Refetch error list table data

**API Endpoints**:

- `POST /api/v1/monitoring/errors/bulk-create-tickets` (Body: `{ "errorIds": ["id1", "id2"] }`)
  - Response: `{ "created": 2, "skipped": 0, "errors": [] }`
- `POST /api/v1/monitoring/errors/bulk-acknowledge` (Body: `{ "errorIds": ["id1", "id2"] }`)
  - Response: `{ "acknowledged": 2, "errors": [] }`
- `GET /api/v1/monitoring/errors/export?ids=id1,id2` (Returns CSV file)
  - Header: `Content-Type: text/csv`, `Content-Disposition: attachment; filename=production-errors.csv`

**Components**:

- `BulkActionsToolbar.tsx` (appears above table when rows selected)
- Use shadcn/ui `Button`, `AlertDialog`, `Separator`
- Use `lucide-react` icons: `Ticket`, `CheckSquare`, `Download`

### AC#9: RBAC-Aware UI Permissions

**Given** I am authenticated with a specific role  
**Then**:

- **MANAGER, TL, QA, PM, OPS roles**: Full access - can view, create fix tickets, acknowledge errors, use bulk actions
- **DEVELOPER role**: Read-only access - can view errors and detail modal, BUT cannot create tickets, acknowledge, or use bulk actions

**Implementation**:

- Use existing `useAuth()` hook from dsf-dashboard auth context to get current user role
- Create helper function: `canManageErrors(role)` returns `true` for MANAGER | TL | QA | PM | OPS
- Conditionally render:
  - Hide "Create Fix Ticket" button in error detail modal if not authorized
  - Hide "Mark as Acknowledged" button if not authorized
  - Hide bulk actions toolbar entirely if not authorized
  - Disable row selection checkboxes if not authorized
- Display read-only badge or info message if user is DEVELOPER

### AC#10: Responsive Design & Mobile Support

**Given** I access the dashboard from different device sizes  
**Then** the layout should adapt:

- **Desktop (≥1024px)**:
  - 4-column grid for overview widget
  - 3-4 column grid for application health heatmap
  - Full table with all columns visible
  - Sidebar navigation visible
- **Tablet (768px-1023px)**:
  - 2-column grid for overview widget
  - 2-column grid for application health heatmap
  - Table with fewer columns (hide "Affected Users" and "Status")
  - Collapsible sidebar
- **Mobile (<768px)**:
  - Single column layout for all sections
  - Overview widget as vertical cards
  - Application health heatmap as single column
  - Table as list view (card-based, not table rows)
  - Hamburger menu for sidebar

**Use Tailwind CSS responsive utilities**:

- `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4`
- `hidden md:table-cell` for optional columns
- `flex flex-col md:flex-row` for layout adaptation

## Tasks / Subtasks

### Task 1: Project Setup & Dependencies (AC#1)

- [ ] Install frontend dependencies in `dsf-dashboard` repository:
  ```bash
  npm install socket.io-client recharts react-syntax-highlighter
  npm install -D @types/react-syntax-highlighter
  ```
- [ ] Verify shadcn/ui components are available: `Table`, `Dialog`, `Toast`, `Card`, `Badge`, `Button`, `Select`, `Checkbox`, `Calendar`, `Popover`, `Skeleton`, `AlertDialog`, `Collapsible`
- [ ] If missing, install: `npx shadcn-ui@latest add table dialog toast card badge button select checkbox calendar popover skeleton alert-dialog collapsible`

### Task 2: Create Page Layout & Routing (AC#1)

- [ ] Create `src/pages/ProductionErrorDashboardPage.tsx`:
  - Import all child components
  - Set up 3-section layout: Overview → Health Heatmap → Trend Chart → Error List
  - Use Tailwind grid classes for responsive layout
- [ ] Update `src/App.tsx` to add route:
  ```tsx
  <Route path="/production-errors" element={<ProductionErrorDashboardPage />} />
  ```
- [ ] Update `src/components/layout/Sidebar.tsx`:
  - Add menu item: "Production Errors" with `AlertTriangle` icon from `lucide-react`
  - Link to `/production-errors`
  - Optional: Add badge showing count of active CRITICAL/HIGH errors (if desired)

### Task 3: Create Error Overview Widget (AC#2)

- [ ] Create `src/components/production-errors/ErrorOverviewWidget.tsx`
- [ ] Create `src/components/production-errors/MetricCard.tsx` (reusable component)
- [ ] Create API hook:  
       `src/hooks/useProductionErrorsOverview.ts` using `react-query` (`useQuery`)
  - Fetches `GET /api/v1/monitoring/errors/overview`
  - Cache key: `['production-errors', 'overview']`
  - Refetch interval: 30 seconds
- [ ] Implement 4 metric cards with:
  - Large numeric value display
  - Descriptive labels
  - Color-coded backgrounds (Tailwind: `bg-slate-100`, `bg-blue-100`, `bg-red-100`, `bg-green-100`)
  - Loading skeleton state using shadcn/ui `Skeleton`

### Task 4: Create Error List Table with Filters (AC#3)

- [ ] Create `src/components/production-errors/ErrorListTable.tsx`
- [ ] Create `src/components/production-errors/ErrorTableFilters.tsx`
- [ ] Create API hook:  
       `src/hooks/useProductionErrors.ts` using `react-query` (`useQuery`)
  - Fetches `GET /api/v1/monitoring/errors?{filters}`
  - Cache key: `['production-errors', 'list', filters]`
  - Accepts filter params: `severity`, `application`, `status`, `from`, `to`, `page`, `limit`, `sortBy`, `sortOrder`
- [ ] Implement table with:
  - 8 columns: Checkbox, Application, Error Type, Message (truncated), Severity (badge), Occurred At (relative), Affected Users, Actions
  - Row checkbox for bulk selection
  - Actions dropdown with "View Details" option
- [ ] Implement filters:
  - Multi-select severity filter (shadcn/ui `Select` with `multiple` prop or custom multi-select)
  - Multi-select application filter (auto-populated from data)
  - Single-select status filter
  - Date range picker (shadcn/ui `Calendar` + `Popover`)
- [ ] Implement sorting:
  - Click column headers to toggle sort direction
  - Default: sort by severity DESC, then occurred_at DESC
- [ ] Implement pagination:
  - Pagination controls at table footer
  - Page size: 20 rows

### Task 5: Create Error Detail Modal (AC#4)

- [ ] Create `src/components/production-errors/ErrorDetailModal.tsx`
- [ ] Create API hook:  
       `src/hooks/useProductionErrorDetail.ts` using `react-query` (`useQuery`)
  - Fetches `GET /api/v1/monitoring/errors/:id`
  - Cache key: `['production-errors', 'detail', id]`
- [ ] Implement modal sections:
  - Header: Error Type badge, Severity badge, Timestamp
  - Error Info: Full message, formatted stack trace (use `react-syntax-highlighter` with `vsDark` theme)
  - Deployment Context: Collapsible section (shadcn/ui `Collapsible`) with deployment details
  - Related Commits: Collapsible list with GitHub links
  - User Context: Collapsible section with user data
  - Fix Ticket: Conditional rendering - "View Ticket" button OR "Create Fix Ticket" button
  - Actions: "Mark as Acknowledged" button, "Close" button
- [ ] Create mutation hooks:
  - `useCreateFixTicket()` → `POST /api/v1/monitoring/errors/:id/create-ticket`
  - `useAcknowledgeError()` → `POST /api/v1/monitoring/errors/:id/acknowledge`
  - On success: refetch error detail, show success toast

### Task 6: Implement Real-Time Socket.IO Updates (AC#5)

- [ ] Create `src/hooks/useProductionErrorSocket.ts` custom hook:
  - Connect to Socket.IO server using `socket.io-client`
  - Connect to server URL from environment variable: `VITE_SOCKET_IO_URL` or `http://localhost:3000`
  - Join room: `production_events`
  - Listen for event: `error.created`
  - On event received:
    - Show toast notification (shadcn/ui `Toast` with `useToast()` hook)
    - Invalidate react-query cache: `queryClient.invalidateQueries(['production-errors', 'overview'])` and `['production-errors', 'list']`
    - Prepend new error to table state (if filters match)
- [ ] Implement toast notification:
  - Title: `[${severity}] ${application}`
  - Description: `${error_type}: ${message.substring(0, 100)}...`
  - Variant: `destructive` for CRITICAL/HIGH
  - Duration: 8000ms
- [ ] Implement row highlight animation:
  - Add CSS class `animate-pulse-once` to new row
  - Remove class after 3 seconds

### Task 7: Create Error Trend Chart (AC#6)

- [ ] Create `src/components/production-errors/ErrorTrendChart.tsx`
- [ ] Create API hook:  
       `src/hooks/useProductionErrorTrends.ts` using `react-query` (`useQuery`)
  - Fetches `GET /api/v1/monitoring/errors/trends?days=7`
  - Cache key: `['production-errors', 'trends', days]`
  - Refetch interval: 60 seconds
- [ ] Implement chart using `recharts`:
  - Use `AreaChart` (stacked) or `LineChart` with 4 `Line` components
  - X-axis: Dates (format: "Mon 02/03" using `date-fns` `format()`)
  - Y-axis: Error count
  - Color code series: CRITICAL (#ef4444), HIGH (#f97316), MEDIUM (#eab308), LOW (#3b82f6)
  - Add `Tooltip` showing exact counts on hover
  - Add `Legend` at bottom
- [ ] Optional: Add toggle button to switch between "By Severity" and "By Application" views

### Task 8: Create Application Health Heatmap (AC#7)

- [ ] Create `src/components/production-errors/ApplicationHealthHeatmap.tsx`
- [ ] Create `src/components/production-errors/AppHealthCard.tsx`
- [ ] Create API hook:  
       `src/hooks/useApplicationHealth.ts` using `react-query` (`useQuery`)
  - Fetches `GET /api/v1/monitoring/applications/health`
  - Cache key: `['production-errors', 'applications-health']`
  - Refetch interval: 30 seconds
- [ ] Implement responsive card grid:
  - Tailwind classes: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`
- [ ] Implement health card:
  - Application name (header, bold)
  - Error count badge (e.g., "12 errors")
  - Health status icon: `ShieldCheck` (green), `ShieldAlert` (yellow/orange), `ShieldX` (red)
  - Last error timestamp (relative using `date-fns` `formatDistanceToNow()`)
  - "View Details" link → onClick filters error list table (`setApplicationFilter(application)`)

### Task 9: Create Bulk Actions Toolbar (AC#8)

- [ ] Create `src/components/production-errors/BulkActionsToolbar.tsx`
- [ ] Implement state management:
  - Track selected row IDs in parent `ErrorListTable`
  - Pass `selectedRows` and `onClearSelection` as props to toolbar
  - Show toolbar only when `selectedRows.length > 0`
- [ ] Implement bulk actions:
  - **Create Fix Tickets**: `POST /api/v1/monitoring/errors/bulk-create-tickets`
  - **Mark as Acknowledged**: `POST /api/v1/monitoring/errors/bulk-acknowledge`
  - **Export to CSV**: `GET /api/v1/monitoring/errors/export?ids=...`
- [ ] Create mutation hooks:
  - `useBulkCreateFixTickets()` → `POST /api/v1/monitoring/errors/bulk-create-tickets`
  - `useBulkAcknowledgeErrors()` → `POST /api/v1/monitoring/errors/bulk-acknowledge`
  - On success: refetch error list, clear selection, show success toast
- [ ] Implement confirmation dialogs:
  - Use shadcn/ui `AlertDialog` for each action
  - Show count of selected errors in dialog message
- [ ] Implement CSV export:
  - Trigger file download using `fetch()` and `Blob` API
  - Set appropriate file name: `production-errors-${timestamp}.csv`

### Task 10: Implement RBAC Permissions (AC#9)

- [ ] Create helper function `src/utils/permissions.ts`:
  ```typescript
  export const canManageErrors = (role: UserRole): boolean => {
    return ['MANAGER', 'TL', 'QA', 'PM', 'OPS'].includes(role);
  };
  ```
- [ ] Update components to use RBAC:
  - `ErrorDetailModal.tsx`: Hide "Create Fix Ticket" and "Mark as Acknowledged" buttons if not authorized
  - `ErrorListTable.tsx`: Hide checkbox column if not authorized
  - `BulkActionsToolbar.tsx`: Don't render if not authorized
- [ ] Display read-only indicator:
  - If user is DEVELOPER, show info message at top of page: "You have read-only access to this dashboard."

### Task 11: Implement Responsive Design (AC#10)

- [ ] Review all components and ensure Tailwind responsive classes are used:
  - `ProductionErrorDashboardPage.tsx`: Layout grid adapts to screen size
  - `ErrorOverviewWidget.tsx`: 4 cols desktop → 2 cols tablet → 1 col mobile
  - `ApplicationHealthHeatmap.tsx`: 3-4 cols desktop → 2 cols tablet → 1 col mobile
  - `ErrorListTable.tsx`: Hide optional columns on mobile, switch to card-based list view
- [ ] Test on multiple screen sizes using browser DevTools

### Task 12: Integration Testing & Manual Verification

- [ ] Start backend dev server: `npm run start:dev` (in Dark Software Factory repo)
- [ ] Start frontend dev server: `npm run dev` (in dsf-dashboard repo)
- [ ] Ensure Socket.IO is running and accessible
- [ ] Test scenarios:
  1. **Dashboard Load**: Navigate to `/production-errors` → Verify overview widget loads with data
  2. **Filtering**: Apply severity filter (CRITICAL) → Verify table updates correctly
  3. **Error Detail**: Click error row → Verify modal opens with all sections populated
  4. **Real-Time**: Trigger test Socket.IO event → Verify toast notification appears and counts update
  5. **Bulk Actions**: Select 2 errors → Click "Create Fix Tickets" → Verify ClickUp tickets created
  6. **CSV Export**: Select errors → Click "Export to CSV" → Verify file downloads
  7. **RBAC**: Log in as DEVELOPER → Verify bulk actions toolbar is hidden
  8. **Responsive**: Test on mobile (DevTools) → Verify layout adapts correctly

### Task 13: Documentation & Cleanup

- [ ] Update `README.md` in dsf-dashboard repository with:
  - Screenshot of dashboard (if available)
  - Description of production error monitoring features
  - Link to backend Story 9-U-5 documentation
- [ ] Add JSDoc comments to all public components and hooks
- [ ] Remove any console.log debugging statements
- [ ] Run linter: `npm run lint` and fix any issues
- [ ] Run TypeScript type check: `npx tsc --noEmit` and fix any type errors

## Dev Notes

### Architecture Patterns

**Frontend Repository**: `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/`

**Tech Stack**:

- **React 19**: Component library
- **TypeScript**: Type safety
- **Tailwind CSS v4**: Styling (latest utility-first framework)
- **shadcn/ui**: Component library (Radix UI primitives + CVA)
- **React Query (TanStack Query)**: Data fetching, caching, synchronization
- **Socket.IO Client**: WebSocket connection for real-time updates
- **Recharts**: Charting library for error trends
- **React Syntax Highlighter**: Stack trace code highlighting
- **React Table (@tanstack/react-table)**: Table state management (sorting, filtering, pagination)

### Backend API Endpoints (from Story 9-U-5)

All endpoints are under `/api/v1/monitoring/errors`:

1. `GET /api/v1/monitoring/errors/overview` → Overview metrics (total active, new 24h, critical/high count, MTTR)
2. `GET /api/v1/monitoring/errors?filters={...}` → Paginated error list with filters
3. `GET /api/v1/monitoring/errors/:id` → Single error details
4. `GET /api/v1/monitoring/errors/trends?days=7` → Trend data (7-day rolling)
5. `GET /api/v1/monitoring/applications/health` → Application health heatmap data
6. `POST /api/v1/monitoring/errors/bulk-create-tickets` → Bulk ClickUp ticket creation
7. `POST /api/v1/monitoring/errors/bulk-acknowledge` → Bulk acknowledge errors
8. `GET /api/v1/monitoring/errors/export?ids={...}` → CSV export

All endpoints require authentication (`JwtAuthGuard`) and role-based access (`RolesGuard`).

### Component Hierarchy

```
ProductionErrorDashboardPage.tsx
├── ErrorOverviewWidget.tsx
│   └── MetricCard.tsx (x4: Total Active, New 24h, Critical/High, MTTR)
├── ApplicationHealthHeatmap.tsx
│   └── AppHealthCard.tsx (one per application)
├── ErrorTrendChart.tsx (Recharts AreaChart)
├── ErrorTableFilters.tsx (Severity, Application, Status, Date Range filters)
├── ErrorListTable.tsx
│   ├── Table (shadcn/ui)
│   ├── Checkbox column (for bulk selection)
│   └── Actions column (opens ErrorDetailModal)
├── BulkActionsToolbar.tsx (conditionally rendered when rows selected)
└── ErrorDetailModal.tsx (Dialog component)
    ├── Error Info section
    ├── Stack Trace section (react-syntax-highlighter)
    ├── Deployment Context section (Collapsible)
    ├── Related Commits section (Collapsible)
    ├── User Context section (Collapsible)
    └── Actions (Create Fix Ticket, Mark as Acknowledged)
```

### References

- [Source: Story 9-U-5 - Production Error Dashboard Backend](./9-U-5-production-error-dashboard.md)
- [Source: Story 10-U-1 - Socket.IO Real-Time Infrastructure](./10-U-1-socket-io-real-time-infrastructure.md)
- [Source: Story 9-U-3 - Automatic Fix Ticket Creation](./9-U-3-automatic-fix-ticket-creation.md)
- [Source: Story 9-U-4 - Error Context Extraction](./9-U-4-error-context-extraction-linking.md)
- [Source: dsf-dashboard Repository](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/)
- [Source: shadcn/ui Documentation](https://ui.shadcn.com/)
- [Source: Recharts Documentation](https://recharts.org/)
- [Source: React Query Documentation](https://tanstack.com/query/)
- [Source: Socket.IO Client Documentation](https://socket.io/docs/v4/client-api/)

## Dev Agent Record

### Agent Model Used

<!-- To be filled by dev agent -->

### Debug Log References

<!-- To be filled by dev agent -->

### Completion Notes List

<!-- To be filled by dev agent -->

### File List

<!-- To be filled by dev agent -->
