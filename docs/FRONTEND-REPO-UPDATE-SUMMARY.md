# Frontend Repository Relocation - Documentation Update Summary

**Date:** 2025-12-25  
**Updated By:** AI Assistant  
**Requested By:** User

## Overview

Updated all documentation, epics, and stories to reflect that the frontend/dashboard is now maintained in a separate repository at `/Volumes/Data/project/products/alpharages/dsf-dashboard` instead of being within the Dark Software Factory repository.

## Changes Made

### 1. Story File: 5-1-pm-dashboard-api-orchestration.md

**File:** `_bmad-output/implementation-artifacts/5-1-pm-dashboard-api-orchestration.md`

**Changes:**

- Updated **Frontend Integration Point** section (lines 286-307)
- Changed frontend path from `./frontend/` to `/Volumes/Data/project/products/alpharages/dsf-dashboard/`
- Added note clarifying the frontend is a separate repository for independent development and deployment
- Updated setup instructions to reflect the new repository structure

**Before:**

```markdown
- Frontend: `/Volumes/Data/project/products/alpharages/Dark Software Factory/frontend/` (React - CREATE IF NOT EXISTS)
```

**After:**

```markdown
- Frontend: `/Volumes/Data/project/products/alpharages/dsf-dashboard/` (React - Separate Repository)

> [!NOTE]
> The frontend/dashboard is maintained in a separate repository at `../dsf-dashboard` for independent development and deployment.
```

---

### 2. Epic Documentation: epics.md

**File:** `docs/epics.md`

**Changes:**

- Updated Story 5.1 technical notes (line 1987)
- Specified the exact path to the separate frontend repository

**Before:**

```markdown
- Create frontend in separate repo or monorepo `/apps/dashboard`
```

**After:**

```markdown
- **Frontend Repository:** Separate repository at `/Volumes/Data/project/products/alpharages/dsf-dashboard` (React + TypeScript)
```

---

### 3. Architecture Documentation: architecture.md

**File:** `_bmad-output/planning-artifacts/architecture.md`

**Changes Made:**

#### a. Dashboard API Implementation Notes (lines 389-394)

- Clarified that dashboard controllers are consumed by the separate repository
- Added explicit repository path reference

**Before:**

```markdown
- All dashboard controllers expose REST APIs consumed by AetherFlow frontend
```

**After:**

```markdown
- All dashboard controllers expose REST APIs consumed by frontend (separate `dsf-dashboard` repository)
- Socket.IO gateway (`realtime/realtime.gateway.ts`) pushes updates to connected clients
- Dashboard data refreshes: Real-time (Socket.IO) + Polling fallback (every 30s)
- Frontend repository: `/Volumes/Data/project/products/alpharages/dsf-dashboard` (React + TypeScript)
```

#### b. CORS Configuration (line 2665)

- Updated CORS origin reference to reflect separate dashboard deployment

**Before:**

```markdown
- Allow: AetherFlow frontend origin
```

**After:**

```markdown
- Allow: Dashboard frontend origin (dsf-dashboard repository - separate deployment)
```

---

### 4. Implementation Plan V3: implementation-plan-v3.md

**File:** `docs/implementation-plan-v3.md`

**Changes:**

- Updated "Frontend Dashboard" section (lines 1112-1123)
- Changed title from "React/Next.js" to "Separate Repository"
- Added repository path and clarifying note

**Before:**

```markdown
##### [NEW] Frontend Dashboard (React/Next.js)

Create comprehensive dashboard UI with:
```

**After:**

```markdown
##### [NEW] Frontend Dashboard (Separate Repository)

**Repository:** `/Volumes/Data/project/products/alpharages/dsf-dashboard` (React + TypeScript)

Create comprehensive dashboard UI in the separate `dsf-dashboard` repository with:
...
**Note:** The dashboard is maintained as a separate repository for independent development and deployment cycles.
```

---

## Repository Structure

### Backend (Dark Software Factory)

**Path:** `/Volumes/Data/project/products/alpharages/Dark Software Factory/`
**Technology:** NestJS + TypeScript + PostgreSQL
**Purpose:** API services, orchestration, business logic

### Frontend (Dashboard)

**Path:** `/Volumes/Data/project/products/alpharages/dsf-dashboard/`
**Technology:** React + TypeScript + Tailwind CSS
**Purpose:** User interface for PM, TL, QA, Manager, and Operator dashboards

---

## Benefits of Separate Repository

1. **Independent Deployment Cycles:** Frontend and backend can be deployed independently
2. **Team Autonomy:** Frontend and backend teams can work without conflicts
3. **Technology Flexibility:** Different CI/CD pipelines, testing strategies, and deployment targets
4. **Clear Separation of Concerns:** API contracts are the integration point
5. **Easier Scaling:** Frontend can scale horizontally independent of backend

---

## Integration Points

### API Endpoints

Backend exposes REST APIs consumed by frontend:

- `GET /api/v1/pm-dashboard/projects` - Project list
- `GET /api/v1/pm-dashboard/summary` - Dashboard summary
- Additional endpoints per Epic 5, 6, 7, 8, etc.

### Real-Time Communication

- **WebSocket:** `ws://localhost:3000/dashboard` (Socket.IO)
- **Events:** `project-updated`, `ticket-status-changed`, etc.
- **Authentication:** JWT token passed in Socket.IO handshake

### CORS Configuration

Backend allows dashboard frontend origin for API access:

```typescript
cors: {
  origin: process.env.DASHBOARD_ORIGIN,
  credentials: true
}
```

---

## Next Steps for Development

### For Backend Developers (Dark Software Factory)

- Continue building API endpoints as specified in stories
- Ensure all endpoints follow API contract specifications
- Maintain Socket.IO event contracts
- Document any API changes in Swagger/OpenAPI

### For Frontend Developers (dsf-dashboard)

- Initialize the React + TypeScript project in the separate repository
- Install dependencies: `socket.io-client`, `axios`, `tailwindcss`
- Consume backend APIs per the documented contracts
- Implement real-time updates via Socket.IO
- Follow UX design specifications from `ux-design-specification.md`

---

## Files Updated Summary

| File Path                                                                     | Section Updated                   | Purpose                          |
| ----------------------------------------------------------------------------- | --------------------------------- | -------------------------------- |
| `_bmad-output/implementation-artifacts/5-1-pm-dashboard-api-orchestration.md` | Frontend Integration Point        | Story 5.1 implementation details |
| `docs/epics.md`                                                               | Story 5.1 Technical Notes         | Epic-level frontend reference    |
| `_bmad-output/planning-artifacts/architecture.md`                             | Implementation Notes, CORS Config | Architecture documentation       |
| `docs/implementation-plan-v3.md`                                              | Frontend Dashboard Section        | Phase 4 implementation plan      |

---

## Validation

All documentation now consistently references:

- ✅ Separate repository at `/Volumes/Data/project/products/alpharages/dsf-dashboard`
- ✅ Technology stack: React + TypeScript + Tailwind CSS
- ✅ Independent development and deployment
- ✅ Integration via REST APIs and Socket.IO

---

## Questions or Issues?

If you encounter any inconsistencies in documentation or need clarification on the frontend-backend integration, please refer to:

1. Architecture document: `docs/architecture.md` (API contracts)
2. Story 5.1: `_bmad-output/implementation-artifacts/5-1-pm-dashboard-api-orchestration.md`
3. UX Design Spec: `_bmad-output/planning-artifacts/ux-design-specification.md`
