# Story 4.9: Projects Table & ClickUp-GitHub Integration Mapping

**ID:** 4.9  
**Epic:** 4 (GitHub Integration & Deployment)  
**Status:** backlog  
**Priority:** CRITICAL (Blocks Epic 5)  
**Created:** 2025-12-12  
**Effort Estimate:** 3-4 hours

---

## User Story

**As a System Architect,**  
I want a centralized Projects table that maps ClickUp Lists to GitHub repositories,  
So that the AI execution system knows which repository to clone for each ticket automatically.

---

## Context

**Problem Identified:** Currently, `tickets.project_id` is hardcoded as `'clickup-polling'` instead of containing actual GitHub repository URLs. This breaks the AI execution flow (Stage 7) because the system cannot determine which repository to clone.

**Architectural Gap:**
- ✅ Tickets created from ClickUp tasks
- ❌ No mapping: ClickUp List → GitHub Repository
- ❌ No GitHub installation linkage
- ❌ AI execution cannot clone correct repo

**Solution:** Implement proper relational data model with `projects` table as the source of truth for project configuration.

---

## Delegation Strategy

This is **pure DSF infrastructure** - no AI delegation possible. Database schema, business logic, and API endpoints required.

---

## Acceptance Criteria

### AC#1: Database Schema
- [ ] Create `projects` table via Prisma migration with fields:
  - `id` (UUID primary key)
  - `name` (string, required)
  - `clickup_list_id` (string, unique, nullable) - for ClickUp integration
  - `jira_project_key` (string, unique, nullable) - future Jira support
  - `github_repository_url` (string, required)
  - `github_installation_id` (string, nullable, FK to `github_installations`)
  - `github_branch` (string, default: 'main')
  - `is_active` (boolean, default: true)
  - `created_at`, `updated_at` timestamps
- [ ] Add indexes: `clickup_list_id`, `jira_project_key`
- [ ] Update `tickets` table:
  - Change `project_id` from `String` to proper FK relationship to `projects.id`
  - Add foreign key constraint with CASCADE update

### AC#2: Projects CRUD API
- [ ] Create `/api/v1/projects` REST endpoints:
  - `POST /api/v1/projects` - Create new project
  - `GET /api/v1/projects` - List all projects (with pagination)
  - `GET /api/v1/projects/:id` - Get single project
  - `PATCH /api/v1/projects/:id` - Update project
  - `DELETE /api/v1/projects/:id` - Soft delete (set `is_active = false`)
- [ ] Add authentication guards: @JwtAuthGuard, @RolesGuard(['ADMIN'])
- [ ] Add validation: GitHub URL format, unique ClickUp list IDs
- [ ] Return comprehensive project data including ticket counts

### AC#3: ClickUp Task Consumer Integration
- [ ] Update `ClickUpTaskUpdateConsumer` to:
  - Lookup project by `message.list.id`
  - Throw descriptive error if no project found for list
  - Create ticket with `project_id = project.id` (FK reference)
  - Log project name and repository URL for traceability
- [ ] Add fallback logic:
  - If no project found, check for `GITHUB_DEFAULT_REPOSITORY` env var
  - Create "default" project if it doesn't exist
  - Log warning about missing project configuration

### AC#4: AI Execution Integration
- [ ] Update `WorkspaceService.createWorkspace()` to:
  - Accept `projectId` instead of hardcoded URL
  - Query `projects` table to get:
    - `github_repository_url`
    - `github_installation.access_token` (if linked)
    - `github_branch`
  - Clone correct repository using project configuration
- [ ] Update `IAIExecutionInput` interface to include `projectId`
- [ ] Ensure all AI routing and execution flows pass project context

### AC#5: Data Migration
- [ ] Create migration script to:
  - Create default project for existing tickets with `project_id = 'clickup-polling'`
  - Update all existing tickets to reference default project
  - Validate: all tickets have valid `project_id` FK
- [ ] Seed script for development:
  - Create sample projects for testing
  - Link to GitHub test repositories

### AC#6: Observability & Error Handling
- [ ] Add Prometheus metrics:
  - `projects_total` (gauge by status)
  - `project_lookup_duration_seconds` (histogram)
  - `project_lookup_failures_total` (counter by reason)
- [ ] Add audit logging for project CRUD operations
- [ ] Add Sentry error tracking for:
  - Project not found for ClickUp list
  - Invalid GitHub repository URL
  - GitHub installation not found

---

## Technical Design

### Database Schema (Prisma)

```prisma
model Project {
  id                      String   @id @default(uuid())
  name                    String
  
  // PM Tool Integration (supports ClickUp + future Jira)
  clickup_list_id         String?  @unique
  jira_project_key        String?  @unique
  
  // GitHub Integration
  github_repository_url   String
  github_installation_id  String?
  github_branch           String   @default("main")
  
  // Status
  is_active               Boolean  @default(true)
  
  // Timestamps
  created_at              DateTime @default(now())
  updated_at              DateTime @updatedAt
  
  // Relations
  tickets                 Ticket[]
  github_installation     GitHubInstallation? @relation(fields: [github_installation_id], references: [id])
  
  @@index([clickup_list_id])
  @@index([jira_project_key])
  @@map("projects")
}
```

### API Request/Response DTOs

```typescript
// CreateProjectDto
{
  name: string;               // "E-commerce Platform"
  clickup_list_id?: string;   // "901813518753"
 github_repository_url: string; // "https://github.com/org/repo"
  github_installation_id?: string;
  github_branch?: string;     // default: "main"
}

// ProjectResponseDto
{
  id: string;
  name: string;
  clickup_list_id: string | null;
  github_repository_url: string;
  github_branch string;
  is_active: boolean;
  ticket_count: {
    total: number;
    received: number;
    queued: number;
    in_progress: number;
    qa_review: number;
    completed: number;
  };
  created_at: string;
  updated_at: string;
}
```

### ClickUp Integration Flow

```typescript
// Before (broken):
const ticket = await prisma.ticket.create({
  data: {
    project_id: 'clickup-polling', // ❌ Hardcoded
  }
});

// After (correct):
const project = await prisma.project.findUnique({
  where: { clickup_list_id: message.list.id },
  include: { github_installation: true }
});

if (!project) {
  throw new Error(`No project configured for ClickUp list ${message.list.id}`);
}

const ticket = await prisma.ticket.create({
  data: {
    project_id: project.id, // ✅ Proper FK
  }
});

// AI execution gets: project.github_repository_url
```

---

## Dependencies

- **Blocks:** Epic 5 (PM Dashboard) - needs projects data
- **Blocks:** Story 5.1 (PM Dashboard API) - displays projects list
- **Requires:** Story 1.3 (Prisma), Story 2.1 (ClickUp integration)
- **Enhances:** Story 2.6 (Cursor Headless), Story 4.2 (GitHub branching)

---

## Out of Scope (Future Stories)

- **Project UI (Epic 5):** Admin UI for managing projects (drag-drop, bulk import)
- **Multi-Repo Support:** Single ticket spanning multiple repositories
- **Project Templates:** Pre-configured project settings
- **Project Analytics:** Repository health metrics, deployment frequency

---

## Testing Strategy

### Unit Tests (Target: 80% coverage)
- **ProjectsService:**
  - CRUD operations
  - GitHub URL validation
  - ClickUp list ID uniqueness
  - Soft deletion
- **ProjectsController:**
  - Authentication guards
  - Validation pipes
  - Error responses
- **ClickUpTaskUpdateConsumer:**
  - Project lookup logic
  - Fallback to default project
  - Error handling for missing project

### Integration Tests
- **Database:**
  - Prisma migration applies successfully
  - FK constraints enforced
  - Cascade updates work
- **API:**
  - Create project → appears in list
  - Update project → changes persisted
  - Delete project → tickets remain (FK intact)

### E2E Tests
- **Full Flow:**
  1. Create project via API
  2. ClickUp webhook arrives for task in that list
  3. Ticket created with correct `project_id`
  4. AI execution clones correct repository
  5. Verify workspace has correct repo URL

---

## Rollout Plan

### Phase 1: Database Migration (Day 1, 2 hours)
1. Create Prisma migration: 20001212_create_projects_table.sql
2. Run migration on dev database
3. Create default project for existing tickets
4. Validate all tickets have valid `project_id`

### Phase 2: API Implementation (Day 1-2, 3 hours)
1. Create ProjectsModule, ProjectsService, ProjectsController
2. Implement CRUD endpoints
3. Add validation, guards, error handling
4. Write unit tests

### Phase 3: Integration (Day 2, 2 hours)
1. Update ClickUpTaskUpdateConsumer
2. Update WorkspaceService for AI execution
3. Update all execution flows
4. Write integration tests

### Phase 4: Verification (Day 2, 1 hour)
1. Manual test: Create project, trigger ClickUp task, verify AI clones correct repo
2. Run full test suite
3. Deploy to dev environment
4. Update sprint status to "done"

---

## FR/NFR Coverage

### Functional Requirements
- **FR56-59:** Ticket intake - now properly links to projects
- **FR60-65:** AI execution - uses correct repository per project
- **NEW:** Project management foundation for Epic 5

### Non-Functional Requirements
- **NFR-M1:** Maintainability - clean relational model
- **NFR-M4:** Configuration - externalized project settings
- **NFR-S2:** Authorization - RBAC for project management
- **NFR-O5:** Monitoring - Prometheus metrics for lookups

---

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Existing tickets have hardcoded `project_id` | HIGH | Migration script creates default project |
| ClickUp list not in projects table | HIGH | Fallback to default + log warning |
| GitHub installation missing | MED | Fallback to personal access token |
| Breaking change for existing code | MED | Comprehensive test suite before merge |

---

## Success Criteria

**This story is DONE when:**
1. ✅ Projects table created and migrated
2. ✅ CRUD API functional with proper guards
3. ✅ ClickUp consumer uses projects table
4. ✅ AI execution clones correct repository based on project
5. ✅ All tests passing (unit + integration + E2E)
6. ✅ Metrics and audit logs operational
7. ✅ Epic 5 unblocked - PM dashboard can fetch projects list

---

## Notes

**Architecture Significance:** This is foundational infrastructure that enables:
- **Multi-tenant** support (multiple clients, multiple repos)
- **Multi-provider** support (ClickUp + Jira)
- **Scalability** (100+ projects easily)
- **Proper GitHub integration** (installation tokens per repo)

**Epic 5 Impact:** Unlocks PM Dashboard (Story 5.1) by providing:
- Projects list API
- Ticket counts per project
- Repository metadata for display
