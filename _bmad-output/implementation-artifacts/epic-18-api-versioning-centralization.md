# Epic 18: API Versioning Centralization

**Target**: Centralize API version management by moving the version prefix from individual controllers to the global configuration

**Status**: draft  
**Priority**: Medium  
**Dependencies**: None  
**Owner**: TBD

## Context

The Dark Software Factory project currently has an inconsistent and redundant API versioning setup. The global prefix in `main.ts` is set to `'api'`, but nearly all controllers manually include `'api/v1'` in their `@Controller()` decorator. This creates technical debt and makes future API versioning difficult, as updating the version would require changes across 21+ controller files.

NestJS provides built-in URI versioning support that is already enabled in the application (`main.ts` lines 71-74), but it's not being leveraged effectively.

## Problem Statement

1. **Version Duplication**: The API version (`v1`) is hardcoded in 21+ controller files
2. **Difficult Versioning**: Updating to `v2` would require changing every affected controller
3. **Inconsistent Patterns**: Some controllers use proper versioning decorators, while most hardcode the full path
4. **Technical Debt**: Not leveraging NestJS's built-in versioning capabilities
5. **Maintenance Overhead**: Risk of missing controllers during version updates

## Goals

1. **Centralized Version Management**: Set API version once in `main.ts`
2. **Simplified Controllers**: Controllers only specify their resource name (e.g., `'projects'`, not `'api/v1/projects'`)
3. **Easy Version Updates**: Future version changes only require modifying `main.ts`
4. **Consistent Structure**: All API endpoints follow the same routing pattern
5. **Zero Breaking Changes**: Maintain existing API routes during refactoring

## Non-Goals

- Introducing API v2 or multi-version support (this epic only refactors the existing structure)
- Changing any business logic or controller functionality
- Modifying frontend API client configuration

## Stories

### Backend Stories (Dark Software Factory)

#### **[18.1] Update Global API Prefix to Include Version**

- **Effort**: 0.5 hours | **Story Points**: 1
- **Dependencies**: None
- **Scope**:
  - Change global prefix in `main.ts` from `'api'` to `'api/v1'`
  - Update the exclude configuration for Prometheus `/metrics` endpoint
  - Verify Swagger documentation setup remains correct
  - Update Swagger base URL if necessary

**Acceptance Criteria:**

- [ ] Global prefix is set to `'api/v1'` in `main.ts`
- [ ] Prometheus `/metrics` endpoint remains accessible at `/metrics` (not `/api/v1/metrics`)
- [ ] Application starts without errors
- [ ] Health check endpoint (`/health`) remains unaffected

---

#### **[18.2] Refactor Controllers to Remove Version Prefix - Part 1**

- **Effort**: 2 hours | **Story Points**: 3
- **Dependencies**: Story 18.1
- **Scope**:
  - Update the following controllers to remove `'api/v1'` prefix:
    - `architecture-review-metrics.controller.ts`
    - `architecture-review.controller.ts`
    - `architecture-constraints.controller.ts`
    - `capabilities.controller.ts`
    - `file-locks.controller.ts`
    - `webhooks.controller.ts`
    - `audit.controller.ts`
    - `decision-dashboard.controller.ts`
    - `observability-dashboard.controller.ts`
  - Run unit tests for each affected controller
  - Update any controller-specific documentation

**Acceptance Criteria:**

- [ ] All listed controllers use resource-only paths (e.g., `'architecture-review'` instead of `'api/v1/architecture-review'`)
- [ ] All unit tests pass for affected controllers
- [ ] Routes remain accessible at their original paths (e.g., `/api/v1/architecture-review`)

---

#### **[18.3] Refactor Controllers to Remove Version Prefix - Part 2**

- **Effort**: 2 hours | **Story Points**: 3
- **Dependencies**: Story 18.1
- **Scope**:
  - Update the following controllers to remove `'api/v1'` prefix:
    - `approval.controller.ts`
    - `execution.controller.ts`
    - `qa-results.controller.ts` (two controllers in this file)
    - `integrations.controller.ts`
    - `system-config.controller.ts`
    - `financial-metrics.controller.ts`
    - `invitations.controller.ts`
    - `users.controller.ts`
  - Run unit tests for each affected controller
  - Update any controller-specific documentation

**Acceptance Criteria:**

- [ ] All listed controllers use resource-only paths
- [ ] `qa-results.controller.ts` has both controllers updated (`'qa-results'` and `'quality-gate'`)
- [ ] `invitations.controller.ts` maintains nested path (`'auth/invitations'`)
- [ ] All unit tests pass for affected controllers

---

#### **[18.4] Refactor Controllers to Remove Version Prefix - Part 3**

- **Effort**: 1.5 hours | **Story Points**: 2
- **Dependencies**: Story 18.1
- **Scope**:
  - Update the following controllers to remove `'api/v1'` prefix:
    - `project.controller.ts`
    - `ticket-quality.controller.ts`
    - `reports.controller.ts`
  - Fix `conversations.controller.ts` double-version issue (`'v1/conversations'` → `'conversations'`)
  - Fix `cost-dashboard.controller.ts` unversioned route (`'api/costs'` → `'costs'`)
  - Run unit tests for each affected controller

**Acceptance Criteria:**

- [ ] All listed controllers use resource-only paths
- [ ] `conversations.controller.ts` no longer produces `/api/v1/v1/conversations`
- [ ] `cost-dashboard.controller.ts` is now properly versioned at `/api/v1/costs`
- [ ] All unit tests pass

---

#### **[18.5] Integration Testing and Verification**

- **Effort**: 3 hours | **Story Points**: 5
- **Dependencies**: Stories 18.2, 18.3, 18.4
- **Scope**:
  - Run full E2E test suite and fix any failures
  - Update E2E tests that hardcode API paths
  - Manual testing via cURL for all affected endpoints
  - Verify Swagger documentation shows correct paths
  - Test frontend integration (if applicable)
  - Update API documentation with versioning strategy
  - Create a migration guide for external API consumers (if any)

**Testing Checklist:**

- [ ] Unit tests: All controller tests pass
- [ ] E2E tests: Full test suite passes
- [ ] Manual cURL tests: Sample endpoints return expected responses
- [ ] Swagger UI: All endpoints display under `/api/v1/*`
- [ ] Frontend integration: No broken API calls from `dsf-dashboard`
- [ ] No `404 Not Found` errors in application logs

**Acceptance Criteria:**

- [ ] All automated tests pass
- [ ] Swagger documentation accurately reflects new route structure
- [ ] All API endpoints remain accessible at their original paths
- [ ] No breaking changes to external consumers
- [ ] Documentation updated with versioning strategy

---

#### **[18.6] Dashboard API Synchronization**

- **Effort**: 4 hours | **Story Points**: 3
- **Dependencies**: Story 18.5
- **Scope**:
  - Verify `dsf-dashboard` API client configuration
  - Test core dashboard modules (Projects, Conversations, Reports)
  - Fix any hardcoded paths or double-versioning issues in frontend
  - Verify authentication and token refresh flows

**Acceptance Criteria:**

- [ ] `dsf-dashboard` remains fully functional with refactored backend
- [ ] All frontend API calls use the correct `/api/v1` prefix
- [ ] Zero 404 errors in browser console during dashboard usage
- [ ] Authentication and refresh tokens work as expected

## Success Metrics

1. **Zero Breaking Changes**: All existing API routes remain functional
2. **Code Reduction**: Remove ~21 instances of hardcoded `'api/v1'` prefix
3. **Version Update Speed**: Future version updates possible with 1-line change to `main.ts`
4. **Test Coverage**: 100% of affected controllers have passing unit tests
5. **Documentation Accuracy**: Swagger docs correctly reflect all endpoint paths

## Acceptance Criteria (Epic-Level)

- [ ] Global API prefix set to `'api/v1'` in `main.ts`
- [ ] All 21+ controllers refactored to remove `'api/v1'` prefix
- [ ] Fixed `conversations.controller.ts` double-version issue
- [ ] Fixed `cost-dashboard.controller.ts` missing version
- [ ] All unit and E2E tests passing
- [ ] Swagger documentation updated and verified
- [ ] No regression in frontend API integration
- [ ] Documentation includes versioning strategy for future updates

## Technical Notes

### Current State

**Global Prefix (main.ts:66):**

```typescript
app.setGlobalPrefix('api', {
  exclude: [{ path: 'metrics', method: RequestMethod.GET }],
});
```

**Typical Controller Pattern:**

```typescript
@Controller('api/v1/projects') // ❌ Hardcoded version
export class ProjectController {}
```

### Desired State

**Global Prefix (main.ts:66):**

```typescript
app.setGlobalPrefix('api/v1', {
  exclude: [{ path: 'metrics', method: RequestMethod.GET }],
});
```

**Refactored Controller Pattern:**

```typescript
@Controller('projects') // ✅ Resource name only
export class ProjectController {}
```

### Controllers Already Following Best Practices

These controllers already use proper patterns and should remain unchanged:

- `pm-dashboard.controller.ts`: `@Controller({ path: 'pm-dashboard', version: '1' })`
- `metrics.controller.ts`: `@Controller({ path: 'telemetry', version: '1' })`
- `prometheus-metrics.controller.ts`: Uses `VERSION_NEUTRAL`
- `auth.controller.ts`: `@Controller('auth')` (will become `/api/v1/auth`)

### Files Requiring Updates

**Total Controllers to Update:** 23
**Configuration Files:** 1 (`main.ts`)

See implementation plan for complete list.

### Future Versioning Strategy

After this refactoring, introducing API v2 would only require:

1. Update `main.ts` global prefix to `'api/v2'` (or support multiple versions)
2. Optionally use NestJS versioning decorators for controllers that differ between versions

**No controller changes needed for basic version updates.**

## Risks & Mitigations

| Risk                                   | Impact | Mitigation                                                         |
| -------------------------------------- | ------ | ------------------------------------------------------------------ |
| Breaking frontend API integration      | High   | Maintain same routes; test with `dsf-dashboard` before merge       |
| Missing controllers during refactoring | Medium | Use grep search to identify all controllers; comprehensive testing |
| Test failures after refactoring        | Medium | Update tests incrementally; run tests after each controller batch  |
| External API consumers affected        | Low    | Routes remain unchanged; document versioning strategy              |

## Out of Scope (Future Enhancements)

- Implementing API v2 endpoints
- Multi-version API support (running v1 and v2 simultaneously)
- Deprecation warnings for old API versions
- API version auto-detection from client headers
- Comprehensive API versioning documentation

## Dependencies

- None (this is a standalone refactoring epic)

## References

- NestJS Versioning Documentation: https://docs.nestjs.com/techniques/versioning
- Current main.ts configuration: [main.ts:66](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/main.ts#L66)
