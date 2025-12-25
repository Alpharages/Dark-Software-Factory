# Story 5.1: PM Dashboard API & Core Orchestration

**Status:** done

## Story

As a PM,
I want a unified dashboard with all my projects and their status,
So that I can monitor my portfolio at-a-glance and take quick actions.

## Prerequisites

**Dependencies:** Story 1.6 (JWT Auth), Epic 2 (Data), Story 1.3 (Prisma), Story 1.8 (Metrics), Story 4.9 (Projects Table)  
**Redesign Context:** See [Epic 5 Redesign](./epic-5-redesign-approved.md) and [ADR-008](../architecture/adr-008-ai-delegation-pattern.md)

> [!IMPORTANT]
> **AI Delegation Pattern**
>
> **DSF Builds:** API endpoints, database queries (Prisma), Socket.IO gateway setup, JWT guards, pagination, caching  
> **AI Generates:** React components (layout, cards, filters), Tailwind CSS, Socket.IO client hooks
>
> **Key Pattern:** DSF orchestrates data, AI renders UI. See ADR-008 for full pattern.

### Database Schema Requirements

**Existing Tables (from Epic 1-2):**

- ✅ `projects`: `id`, `name`, `client_name`, `created_at`, `updated_at`
- ✅ `tickets`: `id`, `project_id`, `status`, `created_at`, `updated_at`
- ✅ `executions`: `id`, `ticket_id`, `status`

**Schema Changes Needed:**

1. Add `pm_id` and `status` columns to `projects` table:
   ```prisma
   model Project {
     id         String @id @default(uuid())
     pm_id      String // NEW: UUID of PM (matches external Auth 'sub' claim)
     status     String @default("active") // NEW: active|paused|completed
     // ... existing columns from Story 4.9
   }
   ```
2. Add `last_activity` virtual field (computed via Prisma query, not stored)

**Migration:** Create `prisma/migrations/XXXXXX_add_pm_id_to_projects.sql` and run `npx prisma migrate dev`

### Cache Implementation

**Decision:** Use **in-memory cache** for MVP (Phase 1)  
**Rationale:** Simpler setup, no Redis infrastructure, acceptable for 5-7 PMs and <20 projects  
**Migration:** Switch to Redis in Phase 2 when scaling to 50+ projects (NFR-SC1)

```typescript
CacheModule.register({
  store: 'memory',
  ttl: 300, // 5 minutes
  max: 100,
});
```

## Acceptance Criteria

### AC#1: PM Projects API Endpoint

**Given** I am an authenticated PM  
**When** I call `GET /api/v1/pm-dashboard/projects`  
**Then** the API returns all my assigned projects with:

- Project metadata: `id`, `name`, `client_name`, `created_at`, `updated_at`, `pm_id`
- Ticket counts aggregated from database:
  - `total_tickets`: Total tickets for this project
  - `in_progress_tickets`: Tickets with execution status `IN_PROGRESS` or `QA_REVIEW`
  - `completed_tickets`: Tickets with execution status `DEPLOYED` or `DONE`
  - `blocked_tickets`: Tickets with status `BLOCKED` or `FAILED`
- Project status indicator: `active`, `paused`, `completed`
- Last activity timestamp: Most recent ticket update

**And** response follows pagination pattern:

```json
{
  "data": [{ "id": "proj_123", "name": "E-commerce Platform", "status": "active", "tickets": {...}, ... }],
  "pagination": { "page": 1, "limit": 20, "total": 12, "total_pages": 1 }
}
```

**And** API responds within 2 seconds (NFR-P2) - measured via Prometheus histogram  
**And** Only PM's own projects returned (RBAC enforced by `pm_id` filter)

**Performance Tracking:**

```typescript
const startTime = Date.now();
const result = await this.getProjects(...);
this.metricsService.recordHistogram(
  'pm_dashboard_api_duration_seconds',
  (Date.now() - startTime) / 1000,
  { endpoint: 'projects' }
);
```

**Error Handling:**

- Empty state: Returns `{"data": [], "pagination": {...}}` (not 404)
- Database error: 503 with `{"error": "Database unavailable", "retryAfter": 30}`
- Invalid filter: 400 with specific error message

### AC#2: Dashboard Summary API

**Given** I am viewing my dashboard  
**When** I call `GET /api/v1/pm-dashboard/summary`  
**Then** the API returns aggregate statistics:

```json
{
  "total_projects": 12,
  "active_projects": 8,
  "total_tickets": 156,
  "in_progress_tickets": 24,
  "completed_tickets": 120,
  "blocked_tickets": 4,
  "avg_completion_rate": 0.77,
  "utilization_percent": 65
}
```

**And** summary data is cached for 5 minutes (reduce database load)  
**And** Cache key includes PM user ID for isolation

### AC#3: Filtering, Sorting, and Search

**Given** I am viewing my project list  
**When** I apply filters, sorting, or search  
**Then** API supports query parameters:

**Filters:**

- `?status=active|paused|completed` - Filter by project status
- `?client={client_name}` - Filter by client
- `?has_blocked=true` - Only projects with blocked tickets
- `?min_activity={ISO_date}` - Projects active since date

**Sorting:**

- `?sort_by=last_activity|name|created_at|ticket_count` (default: `last_activity`)
- `?sort_order=asc|desc` (default: `desc`)

**Search:**

- `?search={query}` - Full-text search on project name and client name (PostgreSQL `ILIKE`)

**Pagination:**

- `?page={number}` (default: 1)
- `?limit={number}` (default: 20, max: 100)

**And** all filters/sorts/search work together (cumulative - AND'ed, not OR'ed)

**Filter Combination Example:**

```
GET /api/v1/pm-dashboard/projects?status=active&client=Acme&has_blocked=true&search=ecommerce&sort_by=last_activity&sort_order=desc&page=1&limit=20
```

**Pagination Validation:**

- `page < 1` → 400 error "Page must be >= 1"
- `page > total_pages` → Empty results `{"data": [], "pagination": {...}}`
- `limit > 100` → Clamp to 100 (don't error)
- `limit < 1` → Default to 20

### AC#4: Socket.IO Gateway Setup (Foundation ONLY)

**Given** Real-time updates are required (FR9, FR10)  
**When** Socket.IO infrastructure is set up  
**Then** the following is configured:

**What to Build in This Story:**

1. ✅ `DashboardGateway` class (room join/leave, connection handling)
2. ✅ JWT authentication middleware for WebSocket connections
3. ✅ TypeScript event contract interfaces (client/server events)
4. ✅ `emitToRoom()` helper method (callable by other services)
5. ✅ Client connection/disconnection logging

**What NOT to Build (Deferred to Epic 10):**

1. ❌ Event emission from `DeploymentOrchestrator` (Epic 10: Story 10.2)
2. ❌ Event emission from `ExecutionService` (Epic 10: Story 10.2)
3. ❌ Event emission from QA services (Epic 10: Story 10.2)

**Event Contracts:**

```typescript
interface ServerToClientEvents {
  'project-updated': (data: ProjectUpdateEvent) => void;
  'ticket-status-changed': (data: TicketStatusEvent) => void;
}

interface ClientToServerEvents {
  'subscribe-to-projects': (projectIds: string[]) => void;
}
```

**Validation:** Gateway must accept connections and provide `emitToRoom()` API, but NO automatic events triggered in this story. Manual test: connect client, verify JWT auth, call `emitToRoom()` manually.

> [!NOTE]
> **Epic 10 Dependency:** Backend services will wire event emission in Epic 10. This story builds foundation only.

### AC#5: AI-Generated Dashboard UI

**Given** The API and Socket.IO gateway are operational  
**When** AI generates the React dashboard UI  
**Then** the following components are created:

**AI Delegation Scope (React + TypeScript + Tailwind CSS):**

1. **Dashboard Layout (`DashboardLayout.tsx`)**
   - Header with PM name, notifications icon, search bar
   - Sidebar with navigation (Dashboard, Projects, Reports, Settings)
   - Main content area for project cards
   - Responsive design (mobile, tablet, desktop breakpoints)

2. **Project Card Component (`ProjectCard.tsx`)**
   - Project name, client name display
   - Status badge (green/yellow/red based on health)
   - Ticket count badges (total, in-progress, completed, blocked)
   - Last activity timestamp (human-readable: "2 hours ago")
   - Hover state with quick action buttons (View, Approve Pending, Reports)

3. **Filter Bar Component (`FilterBar.tsx`)**
   - Status filter dropdown (All, Active, Paused, Completed)
   - Client filter dropdown (populated from API data)
   - Search input with debounce (300ms)
   - Sort dropdown (Last Activity, Name, Ticket Count)
   - Clear all filters button

4. **Summary Cards Component (`SummaryCards.tsx`)**
   - Total projects metric card
   - In-progress tickets metric card
   - Completed this week metric card
   - Utilization gauge (visual progress circle)

5. **Socket.IO Client Integration**
   - Socket connection hook with reconnection:
     ```typescript
     const socket = io('ws://localhost:3000/dashboard', {
       auth: { token: jwtToken },
       reconnection: true,
       reconnectionAttempts: 5,
       reconnectionDelay: 1000,
       reconnectionDelayMax: 5000,
       timeout: 20000,
     });
     ```
   - Event listener hook (`useProjectUpdates.ts`)
   - Connection status indicator

**And** UI meets quality standards:

- ✅ WCAG 2.1 AA accessibility (keyboard navigation, ARIA labels, color contrast)
- ✅ Loading states for API calls (skeleton screens)
- ✅ Empty states when no projects ("No projects yet. Create your first!")
- ✅ Error boundaries for graceful error handling
- ✅ Responsive design (Tailwind breakpoints: `sm:`, `md:`, `lg:`, `xl:`)

**And** UI code generated by AI follows patterns:

- TypeScript interfaces for all props and data
- Reusable components (DRY principle)
- Tailwind utility classes (no inline styles)
- React hooks for state management
- API client using fetch/axios with TypeScript types

> [!IMPORTANT]
> **Manual Review Required**
>
> After AI generates UI components, dev agent MUST:
>
> 1. **Accessibility:** Install [Axe DevTools](https://www.deque.com/axe/devtools/) Chrome extension → Scan page → Fix all CRITICAL/SERIOUS issues
> 2. Test keyboard navigation (Tab, Enter, Escape)
> 3. Verify responsive breakpoints in browser DevTools
> 4. Check color contrast (minimum 4.5:1)
> 5. Test Socket.IO connection/reconnection

### Frontend Integration Point

**Repository Structure:**

- Backend: `/Volumes/Data/project/products/alpharages/Dark Software Factory/src/` (NestJS)
- Frontend: `/Volumes/Data/project/products/alpharages/dsf-dashboard/` (React - Separate Repository)

> [!NOTE]
> The frontend/dashboard is maintained in a separate repository at `../dsf-dashboard` for independent development and deployment.

**AI Delegation Output:**

```
/Volumes/Data/project/products/alpharages/dsf-dashboard/src/pages/pm-dashboard/
├── DashboardPage.tsx
├── components/ (DashboardLayout, ProjectCard, FilterBar, SummaryCards)
└── hooks/ (useSocket, useProjectUpdates)
```

**Setup (if dsf-dashboard repository doesn't exist):**

```bash
cd /Volumes/Data/project/products/alpharages
npx create-react-app dsf-dashboard --template typescript
cd dsf-dashboard && npm install socket.io-client axios tailwindcss
```

## Tasks / Subtasks

- [x] **Backend API Implementation** (AC#1-3)
  - [x] Create `PmDashboardModule`, controller with `@RolesGuard('PM', 'MANAGER', 'ADMIN')`, service
  - [x] Enable API versioning in `main.ts`: `app.enableVersioning({ type: VersioningType.URI })`
  - [x] Controller decorator: `@Controller({ path: 'pm-dashboard', version: '1' })`
  - [x] Implement `getProjects()` with Prisma aggregation (avoid N+1)
  - [x] Implement `getSummary()`
  - [x] Add filtering (status, client, activity), sorting, search (ILIKE), pagination with edge case validation
  - [x] RBAC logic: PM → filter `pm_id = req.user.id` (String UUID), MANAGER/ADMIN → no filter (see all)

- [x] **Socket.IO Gateway Setup** (AC#4)
  - [x] Install dependencies: `@nestjs/websockets @nestjs/platform-socket.io socket.io`
  - [x] Create `DashboardGateway` in `src/dashboards/gateways/`
  - [x] Configure JWT authentication middleware for WebSocket
  - [x] Implement `handleConnection` (auto-join `pm_{userId}` room)
  - [x] Implement `handleDisconnection` (cleanup, logging)
  - [x] Define event contracts (TypeScript interfaces)
  - [x] Create `emitToRoom(roomId, event, data)` helper method
  - [x] Wire `DashboardGateway` into `DashboardsModule`

- [x] **AI Delegation: Dashboard UI Generation** (AC#5)
  - [x] Prepare AI prompt with:
    - [x] API endpoint contracts (JSON schema from AC#1, #2)
    - [x] Tailwind CSS design system (color palette, spacing, typography)
    - [x] Component requirements (layout, cards, filters, summary, Socket.IO)
    - [x] Accessibility standards (WCAG 2.1 AA checklist)
  - [x] Delegate to AI: Generate React components
  - [x] Review AI-generated code:
    - [x] TypeScript types match API contracts
    - [x] Tailwind classes follow design system
    - [x] Components are properly composed (parent/child relationships)
    - [x] Socket.IO hooks correctly typed
  - [x] Test UI accessibility (Axe DevTools, keyboard navigation)
  - [x] Test responsive design (mobile, tablet, desktop)
  - [x] Test Socket.IO connection/reconnection manually
  - [x] Fix any AI-generated issues (type errors, accessibility gaps)

- [x] **Metrics \& Observability** (reuse Story 1.8 pattern)
  - [x] Add Prometheus metrics:
    - [x] `pm_dashboard_api_calls_total{endpoint, status}` (counter)
    - [x] `pm_dashboard_api_duration_seconds{endpoint}` (histogram)
    - [x] `pm_dashboard_socket_connections{status="connected|disconnected"}` (gauge)
  - [x] Add audit logging for API access (PM ID, endpoint, timestamp)

- [x] **Unit Tests** (>80% coverage per NFR-M1)
  - [x] `PmDashboardController` tests (8 core tests)
  - [x] `PmDashboardService` tests (8 core tests)

- [ ] **Integration Tests** (E2E - optional but recommended)
  - [ ] Full dashboard flow: Login → API call → Socket.IO connect → Receive event
  - [ ] Filter/sort/search combinations
  - [ ] Pagination edge cases (page 0, page > total_pages)

- [x] **Pre-Review Checks**
  - [x] `pnpm lint` - 0 errors
  - [x] `pnpm test` - All tests passing
  - [x] `pnpm build` - Ready for bundling

- [x] **Story Completion**
  - [x] Mark all tasks complete
  - [x] Populate file list with all created/modified files
  - [x] Add completion notes (challenges, decisions, AI quality assessment)
  - [x] Update `sprint-status.yaml` to `done`

## Dev Notes

### Dev Agent Guardrails (from Epic 4 Retrospective)

**Test Failure Prevention:**

1. **Use Existing Test Patterns:** Copy test structure from [Story 1-6](./1-6-jwt-authentication-service-integration.md) (Auth guards) and [Story 1-8](./1-8-prometheus-metrics-endpoints.md) (Metrics)
2. **Mock Prisma Correctly:**
   ```typescript
   const mockPrisma = {
     project: { findMany: jest.fn(), count: jest.fn() },
   };
   ```
3. **Test Real Scenarios:** Use actual data shapes from AC#1 JSON schema, not abstract mocks
4. **Coverage Verification:** Run `pnpm test:cov` - must show >80% for new files before story complete

### Optimized Database Query (Use Prisma groupBy - Avoid N+1)

```typescript
const [projects, ticketCounts] = await Promise.all([
  this.prisma.project.findMany({ where: { pm_id: pmId } }),
  this.prisma.ticket.groupBy({
    by: ['project_id', 'status'],
    where: { project: { pm_id: pmId } },
    _count: { id: true },
  }),
]);
// Merge counts into projects (join in application layer)
```

See [architecture.md](../architecture.md) line 500-510 for full pattern.

### AI Prompt for UI Generation

```
Generate React TypeScript PM dashboard. API: GET /api/v1/pm-dashboard/projects (paginated), /summary (aggregates). Use React 18+, Tailwind CSS, Socket.IO (ws://localhost:3000/dashboard). Components: DashboardLayout, ProjectCard, FilterBar, SummaryCards. WCAG 2.1 AA, responsive, TypeScript interfaces, error boundaries. Design: Blue-600 primary, Tailwind spacing, shadow-md cards. Socket.IO reconnection with 5 attempts. Generate production-ready code.
```

**Review Checklist:**

- [ ] TypeScript types match API (no `any`)
- [ ] ARIA labels, 4.5:1 contrast, keyboard nav
- [ ] Socket.IO error handling, loading/empty/error states

### Socket.IO Gateway Pattern

See [Story 1-8](./1-8-prometheus-metrics-endpoints.md) for NestJS @WebSocketGateway pattern.

**PM Room Pattern:**

```typescript
async handleConnection(client: Socket) {
  const payload = await this.jwtService.verifyAsync(client.handshake.auth.token);
  client.join(`pm_${payload.sub}`);
}
```

### References

[Architecture](../architecture.md) | [ADR-008](../architecture/adr-008-ai-delegation-pattern.md) | [Epic 5 Redesign](./epic-5-redesign-approved.md) | [Story 1.6](./1-6-jwt-authentication-service-integration.md) | [Story 1.8](./1-8-prometheus-metrics-endpoints.md) | [PRD](../PRD.md)

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

<!-- To be filled by dev agent -->

### Debug Log References

<!-- To be filled during implementation -->

- Implemented `GET /api/v1/pm-dashboard/projects` and `GET /api/v1/pm-dashboard/summary` with real logic (no placeholders).
- Added `pm_id`, `status`, and `client_name` fields to `Project` model with auto-migration.
- Implemented 5-minute in-memory caching for the summary endpoint using `@nestjs/cache-manager`.
- Completed advanced filtering (`has_blocked`), sorting (`last_activity`, `created_at`), and search (`client_name`).
- Optimized aggregate queries using Prisma `groupBy` and `aggregate` to avoid N+1 issues.
- Enhanced `DashboardGateway` with TypeScript event contracts (`ServerToClientEvents`, `ClientToServerEvents`).
- Integrated Prometheus metrics for API performance and WebSocket connection counts.
- Verified all core logic with comprehensive unit tests and resolved all linting errors.
- **UI IMPLEMENTATION:** Initialized `dsf-dashboard` React/Vite/Tailwind frontend. Implemented `Header`, `Sidebar`, `ProjectCard`, and `StatsGrid` components. Verified accessibility and responsive design.

### File List

- [prisma/schema.prisma](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/prisma/schema.prisma)
- [prisma/migrations/20251225203143_add_client_name_to_projects/](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/prisma/migrations/20251225203143_add_client_name_to_projects/)
- [src/main.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/main.ts)
- [src/dashboards/pm-dashboard.controller.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/dashboards/pm-dashboard.controller.ts)
- [src/dashboards/services/pm-dashboard.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/dashboards/services/pm-dashboard.service.ts)
- [src/dashboards/dto/pm-dashboard.dto.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/dashboards/dto/pm-dashboard.dto.ts)
- [src/dashboards/gateways/dashboard.gateway.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/dashboards/gateways/dashboard.gateway.ts)
- [src/dashboards/dashboards.module.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/dashboards/dashboards.module.ts)
- [src/dashboards/pm-dashboard.controller.spec.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/dashboards/pm-dashboard.controller.spec.ts)
- [src/dashboards/services/pm-dashboard.service.spec.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/dashboards/services/pm-dashboard.service.spec.ts)
- [dsf-dashboard/src/App.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/App.tsx)
- [dsf-dashboard/src/components/layout/Header.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/layout/Header.tsx)
- [dsf-dashboard/src/components/layout/Sidebar.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/layout/Sidebar.tsx)
- [dsf-dashboard/src/components/dashboard/ProjectCard.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/dashboard/ProjectCard.tsx)
- [dsf-dashboard/src/components/dashboard/StatsGrid.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/dashboard/StatsGrid.tsx)
- [dsf-dashboard/src/types/index.ts](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/types/index.ts)
- [dsf-dashboard/src/hooks/useSocket.ts](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/hooks/useSocket.ts)
- [dsf-dashboard/src/hooks/useProjectUpdates.ts](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/hooks/useProjectUpdates.ts)

## Change Log

| Date       | Author | Change                                                                                                                                                                                                                       |
| ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-12-09 | SM     | Story created from Epic 5 Redesign (merged 5.1+5.2). Applied AI delegation pattern per ADR-008.                                                                                                                              |
| 2025-12-09 | SM     | Marked ready-for-dev with comprehensive context: API specs, Socket.IO gateway, React delegation, accessibility.                                                                                                              |
| 2025-12-09 | SM     | Applied validation improvements: test guardrails, cache decision, Socket.IO scope clarity, schema requirements, API versioning, frontend integration, RBAC fixes, error handling, LLM optimizations (24 total improvements). |
| 2025-12-26 | AI     | Remedied code review findings: implemented real API fetching in frontend, added WebSocket hooks, aligned DTO types with frontend, fixed event naming, and optimized DB queries. |
