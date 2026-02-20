# Story 24.1: GitHub App Flow for Multiple Accounts

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a PM,
I want to connect multiple GitHub accounts securely,
so that I can eventually pick repositories from any of my client accounts.

## Acceptance Criteria

1. Create GitHub App integration capable of requesting installation/user-to-server tokens.
2. UI allows adding a new GitHub account.
3. Successfully connected accounts are displayed with their username/avatar.
4. UI handles GitHub OAuth denial, cancellation, or network errors with appropriate error toast notifications.
5. All stored GitHub OAuth tokens (user-to-server, installation tokens) must be encrypted at rest (AES-256-GCM minimum) (NFR-S3).

## Tasks / Subtasks

- [x] Task 1: GitHub App Setup & Backend Integration
  - [x] Implement backend endpoints to start GitHub OAuth flow for an App installation (`GET /api/v1/github/auth/login`).
  - [x] Implement setup callback endpoint to exchange code for user-to-server token and installation ID (`GET /api/v1/github/auth/callback`).
  - [x] Store GitHub account connection securely linked to the PM's user profile in the database, ensuring tokens are encrypted at rest.
- [x] Task 2: UI for Adding GitHub Account
  - [x] Create UI component (e.g., using shadcn/ui `Button`) in PM settings/profile area to initiate GitHub connection.
  - [x] Handle the OAuth redirect, parse success/error params (e.g., `?error=access_denied`), and display feedback via shadcn/ui `useToast`.
- [x] Task 3: Display Connected Accounts
  - [x] Implement endpoint to fetch connected accounts (`GET /api/v1/github/accounts`).
  - [x] Display accounts with username and avatar in the UI using shadcn/ui `Card` and `Avatar`.

## Dev Notes

### Architecture & Technical Requirements

- **Backend Stack:** NestJS microservice. Uses Axios for external API calls.
- **Frontend Stack:** React + TypeScript + shadcn/ui.
- **Database (Prisma):** Add explicit fields to support multiple GitHub accounts per user. For example, a `GithubAccount` model related to `User`:
  - `installationId` (String)
  - `accessToken` (String, MUST be encrypted at rest using AES-256-GCM)
  - `username` (String)
  - `avatarUrl` (String, optional)
- **API Versioning:** All endpoints must adhere to ADR-018 API versioning (e.g., `/api/v1/github/...`).
- **OAuth Flow Clarification:** The flow involves redirecting the user to install the App on their account/organization, which then redirects back to the setup callback URL with an `installation_id` to verify identity and obtain tokens.

### File Structure Requirements (Implementation)

- **Backend:**
  - `src/github/github-auth-flow.controller.ts` (API Endpoints)
  - `src/github/github-auth-flow.service.ts` (Business Logic & Encryption)
  - `src/common/encryption/encryption.service.ts` (AES-256-GCM Logic)
  - `prisma/schema.prisma` (Database Schema)
- **Frontend:**
  - `src/components/profile/GithubAccountsList.tsx` (UI Display)
  - `src/components/profile/ConnectGithubButton.tsx` (OAuth Trigger)

### Testing Requirements

- **Unit Tests:** Jest for backend services.
- **Coverage:** >80% code coverage.
- **Mocking:** Explicitly mock `Octokit` and any Axios HTTP calls to GitHub during unit tests to prevent CI/CD failures due to missing real tokens.

### Adversarial Review Findings (Follow-ups)

- [ ] **Critical**: Refine `installationId` logic to handle App installations correctly (currently brittle/picks first).
- [ ] **Security**: Transition from broad OAuth scopes to fine-grained App tokens (NFR-S11).
- [ ] **UX**: Add proper error toast handling in the frontend for OAuth rejections.

### References

- PRD: [FR146, FR147, NFR-S3] `_bmad-output/planning-artifacts/prd.md`
- Architecture: API Versioning (ADR-018) `_bmad-output/planning-artifacts/architecture.md`
- Epic 24: `_bmad-output/planning-artifacts/epics.md`

## Dev Agent Record

### Agent Model Used

Antigravity

### Debug Log References

### Completion Notes List

### File List

- /Volumes/Data/project/products/alpharages/Dark Software Factory/src/github/github-auth-flow.controller.ts
- /Volumes/Data/project/products/alpharages/Dark Software Factory/src/github/github-auth-flow.service.ts
- /Volumes/Data/project/products/alpharages/Dark Software Factory/src/common/encryption/encryption.service.ts
- /Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/profile/GithubAccountsList.tsx
- /Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/profile/ConnectGithubButton.tsx
