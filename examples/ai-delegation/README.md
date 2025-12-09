# AI Delegation Examples

This directory contains working examples of the AI Delegation Pattern discovered in Epic 4.

## Purpose

These examples demonstrate how to **delegate** tool execution, parsing, and formatting to AI agents instead of building custom service implementations.

## Pattern Overview

**Dark Software Factory (DSF) Owns:**
1. Orchestration - Decide WHEN to execute
2. Instruction - Tell AI WHAT to execute
3. Storage - Save AI results to database
4. Decision - Apply business logic
5. Observability - Record metrics and logs

**AI Tool Owns:**
1. Execution - Run commands
2. Parsing - Interpret outputs
3. Analysis - Summarize and categorize
4. Formatting - Return structured data

## Examples

### 1. Lint Delegation Example
- **File:** `lint-delegation-example.ts`
- **Story:** 3.10 - QA Automation AI Delegation Refactor
- **Shows:** How to delegate linting to AI instead of building custom parsers
- **LOC Saved:** ~500 per linter

### 2. Git Delegation Example
- **File:** `git-delegation-example.ts`
- **Story:** 4.3 - Git Commit Generation & Push
- **Shows:** How to delegate commit message generation to AI
- **LOC Saved:** ~200

### 3. PR Delegation Example
- **File:** `pr-delegation-example.ts`
- **Story:** 4.4 - Pull Request Creation & Metadata
- **Shows:** How to delegate PR description formatting to AI
- **LOC Saved:** ~150

## Key Insights

1. **Client projects already have tooling** (`npm run lint`, `npm run test`)
2. **AI can parse outputs** better than regex patterns
3. **Token costs are negligible** vs. developer time savings ($50/month vs $20K/month)
4. **Works across languages** - one implementation for Node.js, Python, Ruby, etc.

## References

- [ADR-008: AI Delegation Pattern](../../docs/architecture/adr-008-ai-delegation-pattern.md)
- [Architecture: AI Delegation Guidelines](../../docs/architecture.md#ai-delegation-pattern--guidelines)
- [Epic 4 Retrospective](../../docs/sprint-artifacts/epic-4-retro-2025-12-08.md)
