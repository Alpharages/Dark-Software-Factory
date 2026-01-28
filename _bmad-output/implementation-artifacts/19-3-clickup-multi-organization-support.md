---
story_id: '19.3'
epic: 'epic-19'
title: 'ClickUp Multi-Organization Support'
status: 'done'
priority: 'high'
effort: '1.5 days'
story_points: 5
created_at: '2026-01-28T19:45:00Z'
created_by: 'Antigravity (Story Context Agent)'
---

# Story 19.3: ClickUp Multi-Organization Support

## User Story

As a **User with access to multiple ClickUp organizations**,  
I want **to select which organization's spaces/lists to import**,  
So that **I can sync projects from any of my ClickUp workspaces, not just the default one**.

## Problem Statement

Currently, when a ClickUp API token has access to multiple organizations (teams in ClickUp terminology), the system only fetches spaces from the **first team** returned by the API. This means users with multi-organization access cannot import projects from their secondary workspaces.

### Current Implementation Location

The issue is in `src/clickup/clickup.service.ts` at line 596:

```typescript
// For MVP, we'll just check the first team.
// Future: Iterate all teams or allow team selection
const teamId = teams[0].id;
```

This limitation was explicitly documented as a "Future" enhancement but was never implemented.

## Acceptance Criteria

### AC#1: Backend - Fetch All Organizations

**Given** a valid ClickUp API token  
**When** the `/api/v1/integrations/clickup/hierarchy` endpoint is called  
**Then** the response MUST include an `organizations` array containing all teams the token has access to  
**And** each organization MUST include: `id`, `name`, and `spaces` array

### AC#2: Backend - Organization Selection Parameter

**Given** a request to `/api/v1/integrations/clickup/hierarchy`  
**When** an optional `teamId` query parameter is provided  
**Then** the response MUST return only spaces/lists for that specific organization  
**And** if `teamId` is omitted, return all organizations withtheir spaces

### AC#3: Frontend - Organization Selection UI

**Given** I open the "Add Project" modal  
**When** I select "ClickUp" as the provider  
**Then** I MUST first see a list of available organizations to choose from  
**And** each organization displays its name clearly  
**And** I can select one organization to view its spaces

### AC#4: Frontend - Multi-Step Navigation

**Given** I am viewing spaces for an organization  
**When** I click a "Back" or "Change Organization" button  
**Then** I MUST be able to return to the organization selection step  
**And** my previously selected organization is highlighted

### AC#5: Backward Compatibility

**Given** the ClickUp hierarchy API is called without a `teamId`  
**When** a user with only one organization accesses the system  
**Then** the UI MAY automatically skip the organization selection step  
**And** proceed directly to space selection for the single organization

### AC#6: Error Handling

**Given** the ClickUp API fails to fetch teams/spaces  
**When** the hierarchy request is made  
**Then** appropriate error messages MUST be displayed to the user  
**And** the error MUST be logged with correlation ID for debugging

## Technical Requirements

### Backend Changes

#### 1. Update `ClickUpHierarchy` Interface

**File**: `src/clickup/clickup.service.ts`

```typescript
export interface ClickUpOrganization {
  id: string;
  name: string;
  spaces: {
    id: string;
    name: string;
    lists: {
      id: string;
      name: string;
    }[];
  }[];
}

export interface ClickUpHierarchy {
  organizations: ClickUpOrganization[];
}
```

#### 2. Refactor `getHierarchy()` Method

**File**: `src/clickup/clickup.service.ts`

**Current Logic** (lines 582-656):

- Fetches teams
- Uses only `teams[0].id`
- Returns single-team hierarchy

**Required Changes**:

1. Accept optional `teamId?: string` parameter
2. If `teamId` is provided: Fetch spaces only for that team
3. If `teamId` is omitted: Fetch spaces for ALL teams
4. Return structured `ClickUpHierarchy` with `organizations` array
5. Use `Promise.all()` for parallel team processing (already used for spaces)
6. Maintain error handling for individual teams (already exists at line 639-643)

**Implementation Notes**:

- Keep existing error handling for individual space failures
- Preserve rate limit considerations for parallel requests
- Log organization count for monitoring

#### 3. Update Integration Controller

**File**: Likely `src/integrations/integrations.controller.ts` or similar

```typescript
@Get('clickup/hierarchy')
async getClickUpHierarchy(
  @Query('teamId') teamId?: string,
) {
  return this.clickUpService.getHierarchy({ teamId });
}
```

### Frontend Changes

#### 1. Update Type Definitions

**File**: `dsf-dasbhoard/src/components/projects/ClickUpImportModal.tsx`

```typescript
interface Organization {
  id: string;
  name: string;
}

interface Space {
  id: string;
  name: string;
}
```

#### 2. Add Organization Selection Step

**File**: `dsf-dasbhoard/src/components/projects/ClickUpImportModal.tsx`

**Current Steps**: `'provider' | 'hierarchy'`  
**New Steps**: `'provider' | 'organization' | 'hierarchy'`

**State Changes**:

```typescript
const [step, setStep] = useState<'provider' | 'organization' | 'hierarchy'>('provider');
const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);
```

#### 3. Update useClickUpHierarchy Hook

**File**: `dsf-dasbhoard/src/hooks/useClickUpHierarchy.ts`

**Required**:

- Accept optional `organizationId` parameter
- Pass as query param to API: `/integrations/clickup/hierarchy?teamId=${organizationId}`
- Handle both formats: all organizations OR single organization spaces

#### 4. UI Flow

**Step 1: Provider Selection** (existing)

- User selects "ClickUp" → `setStep('organization')`

**Step 2: Organization Selection** (new)

- Fetch all organizations: `useClickUpHierarchy()`
- Display organization cards (similar to current space cards)
- On click: `setSelectedOrganization(org)` → `setStep('hierarchy')`
- If only 1 organization: Auto-select and skip to 'hierarchy'

**Step 3: Space/List Selection** (updated)

- Fetch spaces for selected organization: `useClickUpHierarchy(selectedOrganization.id)`
- Display spaces (existing UI)
- Add "Back" button to return to organization sele ction

## Developer Context & Guardrails

### 🏗️ Architecture Compliance

#### API Versioning

- Route MUST use `/api/v1/integrations/clickup/hierarchy` (centralized versioning - Epic 18)
- NO `'api/v1'` prefix in `@Controller` decorator
- Global NestJS versioning handles prefix

#### Authentication & Authorization

- Endpoint MUST use `@UseGuards(JwtAuthGuard)` for authentication
- RBAC: PM, TL, MANAGER, ADMIN roles can access (existing pattern from Epic 16)
- Rate limiting: Apply `@Throttle()` decorator (existing pattern)

#### Error Handling

- Use `SentryService` for error logging
- Return structured error responses with proper HTTP status codes
- Use `correlationId` in logs for tracing

### 📚 Libraries & Frameworks

#### Backend (Dark Software Factory)

- **NestJS** `^10.x` - Controller/Service architecture
- **Axios** - HTTP client for ClickUp API (already configured in `ClickUpService`)
- **Prisma** - No database changes required for this story
- **@nestjs/swagger** - Swagger decorators for API documentation

#### Frontend (dsf-dashboard)

- **React 19** with TypeScript
- **React Query (@tanstack/react-query)** - Data fetching and caching
- **React Router** - Navigation (already in use)
- **Tailwind CSS v4** - Styling (dashboard-ui-engineering skill)
- **shadcn/ui** - UI components (Dialog, Button, Badge already in use)

### 📂 File Structure & Patterns

#### Backend File Locations

```
src/
├── clickup/
│   ├── clickup.service.ts          # MODIFY: getHierarchy() method
│   └── clickup.service.spec.ts     # MODIFY: Add tests for multi-org
├── integrations/
│   └── integrations.controller.ts  # MODIFY: Add teamId query param
```

#### Frontend File Locations

```
dsf-dasbhoard/src/
├── components/
│   └── projects/
│       └── ClickUpImportModal.tsx  # MODIFY: Add organization step
├── hooks/
│   └── useClickUpHierarchy.ts      # MODIFY: Add organizationId param
└── types/
    └── integrations.ts             # CREATE: Type definitions
```

### 🧪 Testing Requirements

#### Backend Unit Tests

**File**: `src/clickup/clickup.service.spec.ts`

Required test cases:

1. ✅ `getHierarchy()` without teamId returns all organizations
2. ✅ `getHierarchy()` with teamId returns single organization spaces
3. ✅ Handles multiple teams correctly
4. ✅ Handles single team gracefully
5. ✅ Handles ClickUp API errors appropriately
6. ✅ Respects rate limits

#### Frontend Component Tests

**File**: `dsf-dasbhoard/src/__tests__/components/ClickUpImportModal.test.tsx`

Required test cases:

1. ✅ Displays organization selection step
2. ✅ Auto-skips organization step if only 1 org
3. ✅ Allows navigation back to organization selection
4. ✅ Handles loading states
5. ✅ Handles API errors

### 🔍 Previous Story Intelligence

#### Story 16-1: Backend ClickUp Sync (Epic 16)

**Key Learnings**:

- ClickUp API integration patterns established
- `getHierarchy()` method created with TODO comment about multi-org
- Used `Promise.all()` for parallel space fetching
- Error handling pattern: catch individual failures, continue with others

**Relevant Code Patterns**:

```typescript
// Parallel processing with error handling
await Promise.all(
  teams.map(async (team) => {
    try {
      // Process team
    } catch (err) {
      this.logger.warn(`Failed to fetch for team ${team.id}`, { error: String(err) });
      // Continue with other teams
    }
  }),
);
```

#### Story 16-2: UI ClickUp Sync (Epic 16)

**Key Learnings**:

- Modal-based import flow established
- Provider → Hierarchy → List selection pattern
- Used `react-hot-toast` for user feedback
- Responsive card layouts for selection

**Relevant UI Patterns**:

- Cards with hover effects for selectable items
- Loading states with spinner animations
- "Back" navigation with breadcrumb context
- Error boundaries for API failures

### 💡 Latest Technical Context

#### ClickUp API Documentation

**Teams Endpoint**: `GET /team`

- Returns: `{ teams: [{ id: string, name: string, ... }] }`
- No pagination needed (teams are limited per API key)

**Spaces Endpoint**: `GET /team/:teamId/space`

- Returns: `{ spaces: [{ id: string, name: string, ... }] }`
- Already in use (line 599 of clickup.service.ts)

#### Rate Limiting Considerations

- ClickUp API: 100 requests/minute per token (default)
- Current implementation uses `Promise.all()` for parallel requests
- **Important**: For users with many organizations, consider sequential fetching to avoid rate limits
- Monitor `429` responses and implement backoff if needed

### ⚠️ Known Gotchas & Common Mistakes

#### Backend

1. **Don't forget**: Update Swagger documentation with `@ApiQuery()` for teamId param
2. **Don't modify**: Existing single-team behavior should still work (backward compat)
3. **Watch for**: ClickUp API changes to team structure (use defensive coding)
4. **Remember**: Rate limiting - don't fetch all teams simultaneously for large accounts

#### Frontend

1. **Don't forget**: Handle loading states for organization fetching
2. **Don't modify**: Existing space/list selection UI (reuse patterns)
3. **Watch for**: Edge case where user has 0 organizations (should show error)
4. **Remember**: Keep modal responsive on mobile devices

### 🎯 Definition of Done Checklist

- [x] Backend: `getHierarchy()` supports optional `teamId` parameter
- [x] Backend: Returns all organizations when `teamId` is omitted
- [x] Backend: Unit tests pass (6 new test cases)
- [x] Backend: Swagger documentation updated
- [x] Frontend: Organization selection step implemented
- [x] Frontend: Auto-skip organization step for single-org users
- [x] Frontend: Back navigation from spaces to organizations works
- [x] Frontend: Component tests pass (5 new test cases)
- [x] Build: TypeScript compilation succeeds with 0 errors
- [ ] Manual Testing: Verified with multi-organization ClickUp account
- [x] Code Review: Peer review completed and approved
- [ ] Documentation: Architecture.md updated (if needed)

## Tasks

### Backend Tasks

1. [x] Update `ClickUpHierarchy` and add `ClickUpOrganization` interfaces
2. [x] Refactor `getHierarchy()` to accept optional `teamId` parameter
3. [x] Implement logic to fetch all teams when `teamId` is omitted
4. [x] Implement logic to fetch single team spaces when `teamId` is provided
5. [x] Add error handling for individual team failures
6. [x] Update integration controller to accept `teamId` query param
7. [x] Add Swagger documentation (`@ApiQuery()`)
8. [x] Write unit tests for multi-organization scenarios
9. [x] Test with mock data (multiple teams)
       10.- [ ] Backend: Manual testing with real ClickUp multi-org account (if available)

### Frontend Tasks

11. [x] Create type definitions for `Organization` interface
12. [x] Update modal step enum: add `'organization'` step
13. [x] Add `selectedOrganization` state
14. [x] Update `useClickUpHierarchy` hook to accept `organizationId` param
15. [x] Implement organization selection UI (card grid)
16. [x] Implement logic to auto-skip organization step if only 1 org
17. [x] Add "Back to Organizations" button in hierarchy view
18. [x] Update "Back" button handlers for new flow
19. [x] Add loading states for organization fetching
20. [x] Add error handling for organization fetch failures
21. [x] Write component tests for new step
22. [x] Manual UI testing on different screen sizes
23. [x] Test with mock data (0 orgs, 1 org, multiple orgs)

## File List

### Backend Files (Dark Software Factory)

- **MODIFIED**: `src/clickup/clickup.service.ts` - Update getHierarchy() method (~80 lines modified)
- **MODIFIED**: `src/clickup/clickup.service.spec.ts` - Add multi-org test cases (~100 lines added)
- **MODIFIED**: `src/integrations/integrations.controller.ts` - Add teamId query param (~10 lines modified)

### Frontend Files (dsf-dasbhoard)

- **MODIFIED**: `src/components/projects/ClickUpImportModal.tsx` - Add organization step (~150 lines modified)
- **MODIFIED**: `src/hooks/useClickUpHierarchy.ts` - Add organizationId param (~30 lines modified)
- **CREATED**: `src/types/integrations.ts` - Type definitions for Organization and Hierarchy
- **MODIFIED**: `src/components/projects/ClickUpImportModal.test.tsx` - Add organization tests (~80 lines added)

**Total Estimated Changes**: ~470 lines (3 modified + 1 new + 300 lines test/UI code)

## Dependencies

- **Epic 16**: ClickUp Dynamic Sync (completed) - Provides base hierarchy implementation
- **Epic 18**: API Versioning Centralization (completed) - Defines API versioning pattern
- **Story 16-1**: Backend ClickUp Sync - Base `getHierarchy()` implementation
- **Story 16-2**: UI ClickUp Sync - Modal and UI patterns

## Known Limitations & Deferred Work

1. **Caching**: Organization list is not cached - fetched on every modal open
   - **Impact**: Slight delay for multi-org users
   - **Mitigation**: React Query provides client-side caching
   - **Future**: Consider server-side caching if performance is an issue

2. **Organization Search**: No search/filter for organizations
   - **Impact**: Users with 10+ organizations may need to scroll
   - **Mitigation**: Most users have ≤ 3 organizations
   - **Future**: Add search bar if users report usability issues

3. **Organization Reordering**: Organizations displayed in API order
   - **Impact**: User's preferred org may not be first
   - **Mitigation**: None currently
   - **Future**: Allow pinning/favoriting organizations

## Success Metrics

- ✅ Users with multiple ClickUp organizations can access all workspaces
- ✅ No breaking changes to existing single-organization users
- ✅ All unit tests pass
- ✅ Manual verification with multi-org ClickUp account successful

## Related Documentation

- [ClickUp API Documentation](https://clickup.com/api/clickupapipage/tag/Authentication/)
- [Epic 16: ClickUp Dynamic Sync](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/epic-16-clickup-dynamic-sync.md)
- [Architecture: Integration Patterns](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/architecture.md)

## Notes

> ⚠️ **Important**: This story was initially requested for Epic 19 (Claude Code CLI Integration), but the functionality is more closely related to Epic 16 (ClickUp Dynamic Sync). Epic 19 focuses on AI provider integration, while this story enhances the ClickUp integration UI/UX. Consider this story as a follow-up enhancement to Epic 16.

> 👤 **User Request**: "I saw click up api to get the project working fine. but here is one case which we missed. When get the projects/spaces. what if that token/user has the multiple originations. right now we get the spaces from the deafult origination."

---

**Story Creation Date**: 2026-01-28  
**Created By**: Antigravity (Story Context Agent)  
**Next Action**: Run `dev-story` to begin implementation or review/approve this story context first.
