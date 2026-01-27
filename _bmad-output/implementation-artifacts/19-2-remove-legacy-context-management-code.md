# Story 19.2: Remove Legacy Context Management Code

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Maintainer,
I want to remove unused context loading and prompt construction logic from the provider,
so that the codebase remains clean and aligned with the new agentic workflow.

## Acceptance Criteria

1. **Given** the `ClaudeCodePromptBuilder` is used for prompt generation
   **When** a prompt is built for Claude Code
   **Then** it MUST NOT include "Project Context" (dependencies, coding standards) or "Inline File Contents".
2. **Given** the `ClaudeCodePromptBuilder`
   **When** generating a prompt
   **Then** it should ONLY include:
   - Role/Task Definition
   - Acceptance Criteria (BDD)
   - High-level Autonomous Instructions (e.g. "Explore the codebase")
3. **Given** `PromptGeneratorService`
   **When** generating a prompt for **Cursor** (Primary Provider)
   **Then** it MUST still include full context and file contents (No regression for Cursor).

4. **Given** `PromptGeneratorService`
   **When** generating a prompt for **Claude Code** (Secondary Provider)
   **Then** it should **SKIP** the expensive context fetching steps (Architecture Constraints, TL Guidance) to optimize performance.

5. **Given** the cleanup
   **When** reviewing `ClaudeCodeProvider`
   **Then** `constructCliPrompt` should rely on the simplified prompt from the builder without redundant wrapping if possible, or wrap it minimally.

## Tasks / Subtasks

- [x] Refactor `ClaudeCodePromptBuilder` (src/ai-routing/prompt-templates/claude-prompt.template.ts) <!-- id: 1 -->
  - [x] Remove `buildProjectContext` method usage and implementation
  - [x] Remove `buildInlineFileContents` method usage and implementation
  - [x] Simplify `buildTechnicalRequirements` to be generic/minimal
  - [x] Update `buildOutputInstructions` to emphasize file exploration
- [x] Optimize `PromptGeneratorService` (src/ai-routing/prompt-generator.service.ts) <!-- id: 2 -->
  - [x] Refactor `generatePrompt` to check if provider needs context BEFORE loading it
  - [x] Skip `architectureConstraintsService.findAll` and `getDefaultProjectContext` for Claude Code
  - [x] Verify `Cursor` path still loads everything correctly
- [x] Update Unit Tests <!-- id: 3 -->
  - [x] Update `prompt-generator.service.spec.ts` to verify context skipping for Claude
  - [x] Update `claude-prompt.template.spec.ts` to assert NO context inclusion (Covered in service spec)
- [x] Cleanup `ClaudeCodeProvider` (src/ai-routing/providers/claude-code.provider.ts) <!-- id: 4 -->
  - [x] Review `constructCliPrompt` to ensure alignment with new builder output

## Dev Notes

- **Architecture Constraints:** The `PromptGeneratorService` is a shared service. Optimization for Claude must be implemented carefully (e.g. `if (provider === AIProvider.CURSOR_HEADLESS)`) to avoid regression for Cursor.
- **Source Tree:**
  - `src/ai-routing/prompt-templates/claude-prompt.template.ts` (TARGET)
  - `src/ai-routing/prompt-generator.service.ts` (TARGET - Optimization)
  - `src/ai-routing/providers/claude-code.provider.ts` (TARGET)
- **Testing:**
  - Run `npm test src/ai-routing` to verify all routing and generation logic.

### Project Structure Notes

- Alignment with unified project structure: Yes.
- Detected conflicts: None.

### References

- [Source: planning-artifacts/epics.md#Story 19.2]
- [Source: src/ai-routing/prompt-templates/claude-prompt.template.ts]

## Dev Agent Record

### Agent Model Used

Antigravity (Analysis & Plan)

### Debug Log References

### Completion Notes List

- Successfully refactored `ClaudeCodePromptBuilder` to remove legacy context injection (Project Context, Inline Files).
- Optimized `PromptGeneratorService` to skip `architectureConstraintsService.findAll` and TL guidance fetching for `CLAUDE_CODE` provider.
- Verified that `CURSOR_HEADLESS` still receives full context via regression tests.
- Simplified `ClaudeCodeProvider.constructCliPrompt` to remove redundant wrapping.
- Updated 16 unit tests to verify new behavior.

### File List

- `src/ai-routing/prompt-templates/claude-prompt.template.ts`
- `src/ai-routing/prompt-generator.service.ts`
- `src/ai-routing/providers/claude-code.provider.ts`
- `src/ai-routing/prompt-generator.service.spec.ts`

## Senior Developer Review (AI)

- **Date:** 2026-01-27
- **Reviewer:** Antigravity (Senior Reviewer)
- **Outcome:** APPROVED
- **Fixes Applied:** None required (Code quality excellent).

### Findings

- **AC Validation**: Verified all ACs are met. `ClaudeCodePromptBuilder` context removal confirmed. `PromptGeneratorService` optimization confirmed.
- **Code Quality**: Tests passed. Clean implementation.
- **Risk**: Low. ARG_MAX risk noted but acceptable due to reduced prompt size.

### Action Items

- [x] Merge to main branch.
