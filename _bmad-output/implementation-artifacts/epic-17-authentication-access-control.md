# Epic 17: Authentication & Access Control

**Target**: Implement invite-only authentication system with login UI, securing dsf-dashboard from public access and enabling role-based access control.

**Status**: backlog  
**Priority**: Critical  
**Dependencies**: Epic 1 (JWT Infrastructure - Story 1.6)  
**Owner**: TBD

## Context

Currently, the dsf-dashboard is publicly accessible without any authentication layer. While the backend has JWT authentication infrastructure from Story 1.6, there is no login page or authentication flow implemented in the frontend. This creates a **critical security vulnerability** as all dashboards, metrics, and controls are accessible to anyone.

## Problem Statement

1. **Public Access Risk**: dsf-dashboard is accessible to anyone with the URL
2. **No Login Flow**: Users cannot authenticate themselves
3. **Missing Invite System**: No mechanism to create and manage user invitations
4. **Incomplete Auth Flow**: Frontend API client has commented-out login redirect (see `src/api/client.ts:27-28`)
5. **No Protected Routes**: All React routes are unprotected

## Goals

1. **Secure Access**: Block all unauthenticated access to dsf-dashboard
2. **Invite-Only**: Implement invitation system (no public signup)
3. **Role-Based UI**: Show/hide features based on user roles (PM, TL, QA, MANAGER, ADMIN)
4. **Seamless UX**: Fast login, remember me, auto-redirect
5. **Admin Management**: Allow admins to create, revoke, and manage user invites

## Non-Goals

- Public sign-up functionality (deliberately excluded per requirements)
- Social logins (OAuth2/SSO) - future enhancement
- Password reset flow - defer to Phase 2
- 2FA/MFA - defer to security hardening phase

## Stories

### Backend Stories (Dark Software Factory)

#### **[17-1] Backend: User Invitation API**

- **Effort**: 2 days | **Story Points**: 5
- **Dependencies**: Story 1.6 (JWT Auth)
- **Scope**:
  - Create `/api/v1/auth/invitations` REST API
  - Database schema: `UserInvitation` table (id, email, role, invitedBy, inviteToken, expiresAt, acceptedAt, status)
  - Endpoints:
    - `POST /api/v1/auth/invitations` - Create invite (ADMIN/MANAGER only)
    - `GET /api/v1/auth/invitations` - List all invites (ADMIN only)
    - `DELETE /api/v1/auth/invitations/:id` - Revoke invite (ADMIN only)
    - `GET /api/v1/auth/invitations/verify/:token` - Verify invite token (public)
  - Email sending integration (using existing notification infrastructure)
  - 7-day expiration for invite tokens
  - One-time use tokens (mark as 'accepted' after first use)

#### **[17-2] Backend: User Registration via Invite**

- **Effort**: 1.5 days | **Story Points**: 3
- **Dependencies**: Story 17-1
- **Scope**:
  - Create `/api/v1/auth/register` endpoint (public, requires valid invite token)
  - Accept: inviteToken, password, fullName
  - Validate invite token is valid, not expired, not used
  - Create `User` record with hashed password (bcrypt)
  - Mark invitation as 'accepted'
  - Return JWT token + user profile
  - Roles assigned based on invitation (not user-selectable)

#### **[17-3] Backend: Login & Session Management**

- **Effort**: 1 day | **Story Points**: 3
- **Dependencies**: Story 17-2
- **Scope**:
  - Create `/api/v1/auth/login` endpoint (public)
  - Accept: email, password
  - Validate credentials, return JWT token
  - Implement refresh token mechanism (7-day access token, 30-day refresh token)
  - Create `/api/v1/auth/refresh` endpoint
  - Create `/api/v1/auth/logout` endpoint (blacklist refresh token)
  - Create `/api/v1/auth/me` endpoint (get current user profile)
  - Rate limiting: 5 failed attempts per 15 minutes

#### **[17-4] Backend: User Management API**

- **Effort**: 1 day | **Story Points**: 3
- **Dependencies**: Story 17-3
- **Scope**:
  - Create `/api/v1/users` REST API
  - Endpoints:
    - `GET /api/v1/users` - List all users (ADMIN only)
    - `GET /api/v1/users/:id` - Get user details (ADMIN only)
    - `PATCH /api/v1/users/:id` - Update user (ADMIN only - can change role, active status)
    - `DELETE /api/v1/users/:id` - Deactivate user (ADMIN only - soft delete)
  - Implement audit logging for user changes
  - Prevent admin from deactivating themselves

### Frontend Stories (dsf-dashboard)

#### **[17-5] UI: Login Page & Authentication Flow**

- **Effort**: 2 days | **Story Points**: 5
- **Dependencies**: Story 17-3 (Backend Login API)
- **Scope**:
  - Create `/login` route with login page UI
  - Form: email + password (Shadcn UI components)
  - Remember me checkbox (localStorage persistence)
  - Error handling (invalid credentials, network errors)
  - Loading states during login
  - Auto-redirect to originally requested page after login
  - Create `AuthProvider` context (React Context API)
  - Store JWT in httpOnly cookie + localStorage fallback
  - Implement auto-refresh logic (refresh token before expiration)

#### **[17-6] UI: Protected Routes & Auth Guards**

- **Effort**: 1 day | **Story Points**: 3
- **Dependencies**: Story 17-5
- **Scope**:
  - Create `ProtectedRoute` component
  - Wrap all routes with `ProtectedRoute` (redirect to `/login` if not authenticated)
  - Implement role-based route guards (e.g., `/architecture-review` requires TL/ADMIN)
  - Show 403 Forbidden page for insufficient permissions
  - Uncomment and fix API client auth interceptor (`src/api/client.ts:27-28`)
  - Auto-redirect on 401 responses

#### **[17-7] UI: Registration Page (Invite-Only)**

- **Effort**: 1.5 days | **Story Points**: 3
- **Dependencies**: Story 17-2 (Backend Registration API)
- **Scope**:
  - Create `/register/:inviteToken` route
  - Verify invite token on page load
  - Show error if token invalid/expired/used
  - Form: fullName, password, confirmPassword
  - Password strength indicator (zxcvbn library integration)
  - Auto-login after successful registration
  - Show assigned role (read-only field)

#### **[17-8] UI: Invite Management Dashboard**

- **Effort**: 2 days | **Story Points**: 5
- **Dependencies**: Story 17-1 (Backend Invite API), Story 17-6 (Auth Guards)
- **Scope**:
  - Create `/admin/invitations` route (ADMIN/MANAGER only)
  - Table: email, role, invited by, status, expires at, actions
  - "Create Invite" button → modal with form (email, role selector)
  - Copy invite link button (copies `https://dashboard.dsf.com/register/{token}`)
  - Revoke invite button (confirmation dialog)
  - Filter by status (pending/accepted/expired/revoked)
  - Pagination (if >50 invites)

#### **[17-9] UI: User Management Dashboard**

- **Effort**: 1.5 days | **Story Points**: 3
- **Dependencies**: Story 17-4 (Backend User API), Story 17-6 (Auth Guards)
- **Scope**:
  - Create `/admin/users` route (ADMIN only)
  - Table: name, email, role, status, last login, actions
  - Edit user modal (change role, activate/deactivate)
  - Confirmation dialog for deactivation
  - Search by name/email
  - Filter by role, status

#### **[17-10] UI: User Profile & Settings**

- **Effort**: 1 day | **Story Points**: 3
- **Dependencies**: Story 17-5 (Auth Provider)
- **Scope**:
  - Create `/profile` route
  - Display user info: name, email, role (read-only)
  - Change password form
  - Logout button
  - Session management (show active sessions - future)
  - Avatar upload - defer to Phase 2

## Success Metrics

1. **Zero Unauthorized Access**: All dsf-dashboard routes require authentication
2. **Fast Login**: Login completes within 2 seconds (NFR-P2)
3. **Invite Conversion**: >90% of invites accepted within 7 days
4. **Admin Efficiency**: Admins can create and send 10 invites in <2 minutes
5. **Role Enforcement**: Users with role=PM cannot access TL/ADMIN features

## Acceptance Criteria (Epic-Level)

- [ ] All dsf-dashboard routes are protected (redirect to `/login` if unauthenticated)
- [ ] Admins can create, list, and revoke invitations
- [ ] Users can register only with valid invite tokens
- [ ] Login flow works with email + password
- [ ] JWT tokens are securely stored and auto-refreshed
- [ ] Role-based UI elements show/hide correctly
- [ ] 401/403 errors handled gracefully in frontend
- [ ] No public signup option exists

## Technical Notes

### Database Schema Changes (Backend)

```prisma
model User {
  id            String   @id @default(uuid())
  email         String   @unique
  password_hash String
  full_name     String
  role          Role
  is_active     Boolean  @default(true)
  last_login_at DateTime?
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt

  invitations UserInvitation[] @relation("InvitedBy")

  @@index([email])
  @@index([is_active])
}

model UserInvitation {
  id            String   @id @default(uuid())
  email         String
  role          Role
  invite_token  String   @unique
  invited_by_id String
  invited_by    User     @relation("InvitedBy", fields: [invited_by_id], references: [id])
  status        InvitationStatus @default(PENDING)
  expires_at    DateTime
  accepted_at   DateTime?
  created_at    DateTime @default(now())

  @@index([invite_token])
  @@index([email])
  @@index([status])
}

enum InvitationStatus {
  PENDING
  ACCEPTED
  EXPIRED
  REVOKED
}

enum Role {
  ADMIN
  MANAGER
  PM
  TL
  QA
  VIEWER
}
```

### Frontend Authentication Flow

```typescript
// AuthProvider context structure
interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  hasRole: (role: Role) => boolean;
  hasAnyRole: (roles: Role[]) => boolean;
}
```

### Security Considerations

- Passwords hashed with bcrypt (cost factor 12)
- JWTs signed with RS256 (asymmetric keys)
- Refresh tokens stored in httpOnly cookies (CSRF protection)
- Access tokens stored in memory (XSS protection)
- Rate limiting on login endpoint (5 attempts per 15 min)
- Invite tokens are cryptographically random (32 bytes)
- RBAC enforced on both backend (guards) and frontend (UI)

## Risks & Mitigations

| Risk                                   | Impact | Mitigation                                                             |
| -------------------------------------- | ------ | ---------------------------------------------------------------------- |
| Users forget passwords (no reset flow) | Medium | Document admin manual password reset process                           |
| Invite emails go to spam               | Medium | Use authenticated SMTP sender, whitelist domain                        |
| Token storage security concerns        | High   | Use httpOnly cookies for refresh tokens, memory-only for access tokens |
| Admin accidentally revokes active user | Medium | Require confirmation dialog, audit log all changes                     |

## Out of Scope (Future Enhancements)

- Password reset flow (Email-based)
- Social logins (Google, GitHub OAuth2)
- Two-Factor Authentication (2FA/MFA)
- Single Sign-On (SSO) integration
- Session management (view/revoke active sessions)
- Password complexity policies (configurable)
- Account lockout after failed attempts
- Email verification on registration

## Dependencies

- Epic 1 Story 1.6: JWT Authentication Service (already completed)
- Email service integration (can use existing notification service)
- Frontend Shadcn UI components (already installed)
- React Router v6 (already in dsf-dashboard)

## References

- Backend Auth Guard: `/src/common/guards/auth.guard.ts`
- JWT Strategy: `/src/auth/strategies/jwt.strategy.ts` (from Story 1.6)
- Frontend API Client: `/dsf-dashboard/src/api/client.ts`
- Role Enum: Backend already has `Role` enum in architecture
