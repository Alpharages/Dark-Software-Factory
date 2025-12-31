# Story 7.5: Architecture Patterns & Constraints

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TL,
I want to define architecture patterns and constraints that AI must follow,
so that AI makes consistent decisions aligned with our standards.

## Acceptance Criteria

1. **Given** I'm defining project architecture rules
   **When** I create patterns and constraints
   **Then** I can specify:
    - **Allowed technologies:** Approved dependencies, frameworks, libraries
    - **Forbidden technologies:** Banned dependencies (security issues, licensing, etc.)
    - **Design patterns:** Required patterns (repository, factory, strategy, etc.)
    - **Coding standards:** Style guides, naming conventions, file structure
    - **Performance requirements:** Response time limits, resource constraints

2. **And** constraints are enforced:
    - AI checks constraints before generating code
    - Violations flagged automatically in ADR
    - AI provides justification if constraint must be violated

3. **And** patterns are reusable:
    - Defined at organization level (apply to all projects)
    - Overridable at project level (project-specific rules)
    - Versioned (track changes over time)

## Tasks / Subtasks

- [ ] Define Data Model (AC: 1, 3)
    - [ ] Create `ArchitectureConstraint` model in Prisma schema
    - [ ] Add `project_id` (optional, for overrides), `scope` (GLOBAL/PROJECT), `type` (TECHNOLOGY, PATTERN, STANDARD), `rules` (JSON)
- [ ] Implement Constraints Service (AC: 1, 3)
    - [ ] CRUD operations for constraints
    - [ ] Constraint resolution logic (Global + Project overrides)
- [ ] Implement Validation Logic (AC: 2)
    - [ ] Create `ConstraintValidatorService`
    - [ ] Validate dependencies (check package.json against rules)
    - [ ] Validate patterns (regex or heuristic checks on code)
- [ ] Integrate with ADR and AI Prompt (AC: 2)
    - [ ] Update Prompt Generator to include resolved constraints
    - [ ] Update ADR generation to flag violations

## Dev Notes

- **Technical Stack**: NestJS, Prisma, PostgreSQL
- **Schema**:
    ```prisma
    model ArchitectureConstraint {
      id        String   @id @default(uuid())
      projectId String?  // Null = Global
      scope     String   // GLOBAL, PROJECT
      type      String   // ALLOWED_TECH, FORBIDDEN_TECH, PATTERN, STANDARD
      rules     Json     // Flexible rule definition
      version   Int      @default(1)
      createdAt DateTime @default(now())
      updatedAt DateTime @updatedAt
    }
    ```
- **Validation Strategy**:
    - For technologies: Parse `package.json` imports.
    - For patterns: This is harder. Start with simple regex/keyword checks or require AI to self-certify in the ADR. "Did you use Repository Pattern? [Yes/No]"

### Project Structure Notes

- Service should live in `src/modules/architecture-review/` to align with Epic 7 domain.

### References

- [Source: docs/epics.md#Story 7.5: Architecture Patterns & Constraints](file:///Volumes/Data/project/products/alpharages/Dark Software Factory/docs/epics.md)

## Dev Agent Record

### Agent Model Used

Antigravity 1.0

### Debug Log References

- None

### Completion Notes List

- Story created from Epic 7 definition.

### File List

- src/architecture-review/architecture-constraints.service.ts
- src/architecture-review/constraint-validator.service.ts
- src/architecture-review/adr.service.ts
- prisma/schema.prisma
