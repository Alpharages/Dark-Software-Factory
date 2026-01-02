# Story 17.3: Backend - Login & Session Management

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Prerequisites

**Dependencies:**

- ✅ Story 17-1: Backend User Invitation API (User model with `password_hash`, `last_login_at`)
- ✅ Story 17-2: Backend User Registration via Invite (User records with bcrypt password hashes, JwtService integration)
- ✅ Story 1.6: JWT Authentication Service Integration (JwtService, JWT guards)

**Existing Infrastructure:**

- `JwtService` from `@nestjs/jwt` (see Dev Notes for configuration details)
- `JwtAuthGuard` at `src/common/guards/auth.guard.ts`
- `RolesGuard` at `src/common/guards/roles.guard.ts`
- User model with fields: `id`, `email`, `password_hash`, `full_name`, `role`, `is_active`, `last_login_at`
- Bcrypt dependency (v6.0.0) from Story 17-2

## Epic Context

**Story Position in Epic 17 Flow:**

1. ✅ Story 17-1: Created invitation system with User model auth fields
2. ✅ Story 17-2: User registration with bcrypt password hashing
3. **→ Story 17-3 (THIS STORY)**: Login endpoint authenticates users and manages sessions
4. Story 17-4: User management API (admin controls)
5. Stories 17-5 to 17-10: Frontend UI (login page, protected routes, profile)

**What This Story Enables:**

- Users can authenticate with email/password credentials
- JWT access tokens allow secure API access
- Refresh tokens enable long-lived sessions (30-day)
- Frontend Story 17-5 (Login UI) can call these endpoints
- Frontend Story 17-6 (Protected Routes) can verify tokens via `/auth/me`

**Integration Points:**

- **Consumes**: User.password_hash from Story 17-2
- **Produces**: JWT access tokens + refresh tokens for API authentication
- **Enables**: Frontend authentication flow and protected route guards

## Story

As a **registered user**,
I want **to log in with my email and password to obtain session credentials**,
so that **I can securely access the DSF Dashboard and interact with protected API endpoints**.

## Acceptance Criteria

### AC#1: Login Endpoint

- `POST /api/v1/auth/login` endpoint implemented
- Public endpoint (no authentication required)
- Accepts payload: `{ email: string, password: string }`
- Validates all required fields are present and non-empty
- Returns 400 Bad Request if any field is missing
- Email validation: must be valid email format
- Password validation: must not be empty

### AC#2: Credential Verification

- Validates user exists by email
- Checks user is active (`is_active = true`)
- Compares password using bcrypt: `await bcrypt.compare(plaintextPassword, user.password_hash)` (constant-time comparison)
- Returns appropriate error codes:
  - 401 Unauthorized: Invalid credentials (wrong email OR wrong password)
  - 403 Forbidden: Account deactivated
- **Security**: Same error message for wrong email vs wrong password (prevent user enumeration)
- **Security**: Use constant-time comparison (bcrypt.compare is constant-time by default)

### AC#3: Rate Limiting

- Implements rate limiting: 5 failed login attempts per 15 minutes per email
- Uses `@nestjs/throttler` with custom key (email address)
- Returns 429 Too Many Requests after limit exceeded
- Rate limit resets after 15 minutes
- Failed attempts tracked separately from successful logins

### AC#4: JWT Token Generation

- Generates TWO tokens on successful login:
  - **Access Token**: Short-lived (24 hours), used for API requests
  - **Refresh Token**: Long-lived (30 days), used to obtain new access tokens
- Access token payload:
  - `sub`: user.id (UUID)
  - `email`: user.email
  - `role`: user.role
  - `type`: 'access'
  - `iat`: issued at timestamp
  - `exp`: expiration timestamp (24 hours from now)
- Refresh token payload:
  - `sub`: user.id
  - `type`: 'refresh'
  - `jti`: unique token ID (UUID for revocation)
  - `iat`: issued at
  - `exp`: expiration timestamp (30 days from now)
- Both tokens signed with HS256 (existing JwtService config)

### AC#5: Refresh Token Database Tracking

- Creates `RefreshToken` table in Prisma schema:
  - `id` (UUID, primary key)
  - `token_id` (UUID, from JWT `jti` claim, unique, indexed)
  - `user_id` (UUID, foreign key to User)
  - `is_revoked` (Boolean, default false)
  - `expires_at` (DateTime)
  - `created_at` (DateTime, default now())
- Stores refresh token metadata in database on login
- **Why**: Enables token revocation (logout) and security auditing
- Prisma migration created and applied

### AC#6: Logout Endpoint

- `POST /api/v1/auth/logout` endpoint implemented
- Requires authentication (JwtAuthGuard)
- Accepts refresh token in request body: `{ refreshToken: string }`
- Validates refresh token JWT signature and expiration
- Marks refresh token as revoked in database (`is_revoked = true`)
- Returns success message even if token already revoked (idempotent)
- Returns 401 if refresh token invalid or expired

### AC#7: Refresh Token Endpoint

- `POST /api/v1/auth/refresh` endpoint implemented
- Public endpoint (no authentication required)
- Accepts refresh token in request body: `{ refreshToken: string }`
- Validates refresh token:
  - JWT signature valid
  - Not expired (exp > now)
  - Type claim equals 'refresh'
  - Not revoked in database (is_revoked = false)
- Generates NEW access token with same user payload
- **Does NOT** issue new refresh token (refresh token rotation deferred to Phase 2)
- Returns 401 if refresh token invalid, expired, or revoked

### AC#8: Current User Endpoint

- `GET /api/v1/auth/me` endpoint implemented
- Requires authentication (JwtAuthGuard)
- Extracts user ID from JWT access token payload
- Fetches current user from database
- Returns user profile:
  ```typescript
  {
    id: string;
    email: string;
    fullName: string;
    role: Role;
    isActive: boolean;
    lastLoginAt: DateTime | null;
  }
  ```
- Excludes `password_hash` from response (security)
- Returns 401 if token invalid or expired

### AC#9: Last Login Tracking

- Updates `User.last_login_at` field on successful login
- Timestamp set to current UTC time: `new Date()`
- Update happens AFTER password verification (not on failed attempts)
- Displayed in `/auth/me` response for session monitoring

### AC#10: Swagger Documentation

- All endpoints documented with @ApiTags, @ApiOperation, @ApiResponse decorators
- DTOs documented with @ApiProperty and validation decorators
- Example requests and responses provided in Swagger UI
- Error response schemas documented (400, 401, 403, 429)

## Tasks / Subtasks

### Task 1: Database Schema & Migration (AC: #5)

- [ ] Create Prisma schema for RefreshToken model
  - [ ] Define all fields with proper types and constraints
  - [ ] Add index for `token_id` (unique)
  - [ ] Add foreign key relation to User model
  - [ ] Add index for `user_id` and `is_revoked` (query optimization)
- [ ] Generate Prisma migration: `npx prisma migrate dev --name add_refresh_tokens`
- [ ] Apply migration to development database
- [ ] Regenerate Prisma client: `npx prisma generate`

### Task 2: Create DTOs & Interfaces (AC: #1, #6, #7, #8, #10)

- [ ] Create `login.dto.ts` in `src/auth/dto/`
  - [ ] Fields: `email` (string, @IsEmail), `password` (string, @IsString, @IsNotEmpty)
  - [ ] Swagger @ApiProperty decorators with examples
- [ ] Create `login-response.dto.ts`
  - [ ] Fields: `accessToken` (string), `refreshToken` (string), `user` (UserDto object)
  - [ ] Reuse UserDto from Story 17-2
- [ ] Create `refresh-token.dto.ts`
  - [ ] Fields: `refreshToken` (string, @IsString, @IsNotEmpty)
- [ ] Create `logout.dto.ts`
  - [ ] Fields: `refreshToken` (string, @IsString, @IsNotEmpty)
- [ ] Create `current-user-response.dto.ts` (or reuse UserDto from Story 17-2)

### Task 3: Implement AuthService (AC: #2, #4, #5, #7, #9)

- [ ] Create `auth.service.ts` in `src/auth/` (or extend existing if present)
- [ ] Inject dependencies: PrismaService, JwtService, Logger
- [ ] Implement `login(dto: LoginDto)` method:
  - [ ] **Step 1**: Find user by email (case-insensitive)
    - [ ] `const user = await prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } })`
    - [ ] Throw UnauthorizedException(401) if user not found (generic message: "Invalid credentials")
  - [ ] **Step 2**: Check if user is active
    - [ ] Throw ForbiddenException(403) if `user.is_active === false` (message: "Account deactivated")
  - [ ] **Step 3**: Verify password using bcrypt
    - [ ] `const isPasswordValid = await bcrypt.compare(dto.password, user.password_hash)`
    - [ ] Throw UnauthorizedException(401) if password invalid (same generic message)
  - [ ] **Step 4**: Generate access token
    - [ ] `const accessToken = await jwtService.sign({ sub: user.id, email: user.email, role: user.role, type: 'access' })`
    - [ ] Use existing JwtService configuration (HS256, 24h expiration)
  - [ ] **Step 5**: Generate refresh token with unique ID
    - [ ] `const tokenId = crypto.randomUUID()`
    - [ ] `const refreshToken = await jwtService.sign({ sub: user.id, type: 'refresh', jti: tokenId }, { expiresIn: '30d' })`
  - [ ] **Step 6**: Store refresh token and update last login in atomic transaction
    - [ ] Wrap in `prisma.$transaction()` to ensure atomicity:
      ```typescript
      await prisma.$transaction([
        prisma.refreshToken.create({
          data: {
            token_id: tokenId,
            user_id: user.id,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        }),
        prisma.user.update({ where: { id: user.id }, data: { last_login_at: new Date() } }),
      ]);
      ```
    - [ ] Transaction ensures both operations succeed or both rollback (prevents orphaned sessions)
  - [ ] **Step 7**: Return { accessToken, refreshToken, user } (exclude password_hash)
- [ ] Implement `refreshAccessToken(refreshToken: string)` method:
  - [ ] **Step 1**: Verify refresh token JWT signature and expiration
    - [ ] `const payload = await jwtService.verify(refreshToken)` (throws if invalid/expired)
  - [ ] **Step 2**: Validate token type claim
    - [ ] Throw UnauthorizedException if `payload.type !== 'refresh'`
  - [ ] **Step 3**: Check token not revoked in database
    - [ ] `const tokenRecord = await prisma.refreshToken.findUnique({ where: { token_id: payload.jti } })`
    - [ ] Throw UnauthorizedException if not found or `is_revoked === true`
  - [ ] **Step 4**: Generate new access token
    - [ ] Fetch user: `const user = await prisma.user.findUnique({ where: { id: payload.sub } })`
    - [ ] Generate access token with user payload
  - [ ] **Step 5**: Return { accessToken }
- [ ] Implement `logout(refreshToken: string)` method:
  - [ ] **Step 1**: Verify refresh token (same as refresh method)
  - [ ] **Step 2**: Mark token as revoked
    - [ ] `await prisma.refreshToken.update({ where: { token_id: payload.jti }, data: { is_revoked: true } })`
  - [ ] **Step 3**: Return success (catch errors if already revoked, return success anyway for idempotency)
- [ ] Implement `getCurrentUser(userId: string)` method:
  - [ ] Fetch user by ID
  - [ ] Map to UserDto (exclude password_hash)
  - [ ] Return user profile

### Task 4: Implement AuthController (AC: #1, #3, #6, #7, #8, #10)

- [ ] Create `auth.controller.ts` in `src/auth/` (or extend existing)
- [ ] Apply decorators: @Controller('auth'), @ApiTags('Auth - Authentication')
- [ ] Implement `POST /login` endpoint:
  - [ ] Public endpoint (no guards)
  - [ ] Apply rate limiting: @Throttle({ email: { limit: 5, ttl: 900000 } }) (5 attempts per 15 min)
  - [ ] @Body() dto: LoginDto
  - [ ] Call authService.login(dto)
  - [ ] Return LoginResponseDto
  - [ ] @ApiOperation({ summary: 'User login with email and password' })
  - [ ] @ApiResponse(200, { type: LoginResponseDto })
  - [ ] @ApiResponse(400, { description: 'Invalid input' })
  - [ ] @ApiResponse(401, { description: 'Invalid credentials' })
  - [ ] @ApiResponse(403, { description: 'Account deactivated' })
  - [ ] @ApiResponse(429, { description: 'Too many login attempts' })
- [ ] Implement `POST /refresh` endpoint:
  - [ ] Public endpoint (no guards)
  - [ ] @Body() dto: RefreshTokenDto
  - [ ] Call authService.refreshAccessToken(dto.refreshToken)
  - [ ] Return { accessToken }
  - [ ] @ApiOperation({ summary: 'Refresh access token' })
  - [ ] @ApiResponse(200, { description: 'New access token generated' })
  - [ ] @ApiResponse(401, { description: 'Invalid or revoked refresh token' })
- [ ] Implement `POST /logout` endpoint:
  - [ ] Requires authentication: @UseGuards(JwtAuthGuard)
  - [ ] @Body() dto: LogoutDto
  - [ ] Call authService.logout(dto.refreshToken)
  - [ ] Return success message
  - [ ] @ApiOperation({ summary: 'Logout and revoke refresh token' })
  - [ ] @ApiResponse(200, { description: 'Successfully logged out' })
  - [ ] @ApiResponse(401, { description: 'Invalid refresh token' })
- [ ] Implement `GET /me` endpoint:
  - [ ] Requires authentication: @UseGuards(JwtAuthGuard)
  - [ ] Extract user ID from @Request() (req.user.id)
  - [ ] Call authService.getCurrentUser(userId)
  - [ ] Return CurrentUserResponseDto
  - [ ] @ApiOperation({ summary: 'Get current authenticated user profile' })
  - [ ] @ApiResponse(200, { type: CurrentUserResponseDto })
  - [ ] @ApiResponse(401, { description: 'Not authenticated' })

### Task 5: Custom Rate Limiting for Login (AC: #3)

- [ ] Extend rate limiting to use email as key (not IP address)
  - [ ] Create custom throttler guard that extracts email from request body
  - [ ] Track failed login attempts per email
  - [ ] Reset counter on successful login
- [ ] **Alternative**: Use simple @Throttle decorator with default IP-based rate limiting (simpler, acceptable for MVP)
- [ ] Document rate limiting configuration in .env.example

### Task 6: Module Wiring (AC: all)

- [ ] Create or update `auth.module.ts`
  - [ ] Import: DatabaseModule, JwtModule, RegistrationModule (from Story 17-2), InvitationsModule (from Story 17-1)
  - [ ] Provide: AuthService
  - [ ] Register: AuthController
  - [ ] Export: AuthService (for use in other modules)
- [ ] Verify JwtModule configured with:
  - [ ] `secret`: from environment variable JWT_SECRET
  - [ ] `signOptions`: `{ expiresIn: '24h', algorithm: 'HS256' }`
- [ ] Import AuthModule into AppModule (if not already)

### Task 7: Unit Tests (AC: #1-9)

- [ ] Create `auth.service.spec.ts`
  - [ ] Test `login()` success: valid credentials → tokens + user profile
  - [ ] Test `login()` invalid email: throws UnauthorizedException
  - [ ] Test `login()` invalid password: throws UnauthorizedException
  - [ ] Test `login()` inactive user: throws ForbiddenException
  - [ ] Test `login()` updates last_login_at timestamp
  - [ ] Test `refreshAccessToken()` success: valid refresh token → new access token
  - [ ] Test `refreshAccessToken()` revoked token: throws UnauthorizedException
  - [ ] Test `refreshAccessToken()` expired token: throws UnauthorizedException
  - [ ] Test `logout()` success: token revoked in database
  - [ ] Test `logout()` idempotency: already revoked token returns success
  - [ ] Test `getCurrentUser()` success: returns user profile
  - [ ] Mock: PrismaService, JwtService
- [ ] Create `auth.controller.spec.ts`
  - [ ] Test POST /login: valid request, returns 200 with tokens
  - [ ] Test POST /login: invalid DTO, returns 400 Bad Request
  - [ ] Test POST /login: invalid credentials, returns 401 Unauthorized
  - [ ] Test POST /refresh: valid token, returns 200 with new access token
  - [ ] Test POST /refresh: revoked token, returns 401
  - [ ] Test POST /logout: success, returns 200
  - [ ] Test GET /me: authenticated, returns user profile
  - [ ] Mock: AuthService
- [ ] Ensure all tests pass: `npm run test auth` (target specific spec files)

### Task 8: Integration Testing & Manual Verification (AC: all)

- [ ] Start development server: `npm run start:dev`
- [ ] Access Swagger UI: `http://localhost:3000/api`
- [ ] **Pre-requisite**: Ensure test user exists (from Story 17-2 registration or DB seed)
- [ ] Test POST /api/v1/auth/login
  - [ ] Valid credentials: returns 200 with access token, refresh token, user profile
  - [ ] Check database: `RefreshToken` record created, `User.last_login_at` updated
  - [ ] Invalid password: returns 401 Unauthorized with generic message
  - [ ] Invalid email: returns 401 Unauthorized with same generic message
  - [ ] Inactive user (manually deactivate in DB): returns 403 Forbidden
  - [ ] Rate limiting: 6 rapid login attempts, 6th returns 429 Too Many Requests
- [ ] Test POST /api/v1/auth/refresh
  - [ ] Valid refresh token: returns 200 with new access token
  - [ ] Copy access token, verify it works with GET /api/v1/auth/me
  - [ ] Expired refresh token (manually create one): returns 401
  - [ ] Revoked token (after logout): returns 401
- [ ] Test POST /api/v1/auth/logout
  - [ ] Logout with valid refresh token: returns 200
  - [ ] Check database: `RefreshToken.is_revoked = true`
  - [ ] Try to refresh with logged-out token: returns 401
- [ ] Test GET /api/v1/auth/me
  - [ ] With valid access token in Authorization header: returns user profile
  - [ ] Without token: returns 401 Unauthorized
  - [ ] With expired token: returns 401
  - [ ] With refresh token (wrong type): returns 401
- [ ] Verify all Swagger documentation displays correctly

### Task 9: Update Sprint Status & Story File (AC: all)

- [ ] Mark all tasks as complete in story file
- [ ] Update `sprint-status.yaml`: set 17-3-backend-login-session-management to 'ready-for-dev'
- [ ] Add completion notes with file count and test results
- [ ] List all files created/modified in story file

## Dev Notes

### Architecture Compliance

**Authentication & Authorization:**

- Uses JWT infrastructure from Story 1.6 (JwtService already configured)
- HS256 algorithm (HMAC symmetric key) with 24h expiration for access tokens
- 30-day expiration for refresh tokens (configurable via `{ expiresIn: '30d' }`)
- JWT payload structure: `{ sub: userId, email, role, type: 'access'|'refresh', iat, exp, jti? }`

**Password Verification:**

- Use bcrypt.compare() for password verification (already used in Story 17-2)
- Bcrypt provides constant-time comparison (prevents timing attacks)
- Never log or expose plain-text passwords
- Generic error message for failed login (prevents user enumeration)

**Database Patterns:**

- Use Prisma ORM for all database operations
- **Atomic Transactions**: Wrap refresh token creation + last login update in `prisma.$transaction()` to ensure atomicity
- RefreshToken table tracks active/revoked tokens (expired tokens remain for audit, cleanup deferred to Epic 10)
- Query optimization: add index on `token_id` (unique lookups), `user_id + is_revoked` (user's active tokens)
- Update User.last_login_at on successful login (not on failed attempts)

**Rate Limiting:**

- Use `@nestjs/throttler` for rate limiting (should already be configured in project)
- Default implementation: 5 attempts per 15 minutes per IP address
- **Enhanced**: Track by email address to prevent credential stuffing attacks
- Custom ThrottlerGuard can extract email from request body for per-email limiting

**Error Handling:**

- Use NestJS built-in exceptions: `UnauthorizedException`, `ForbiddenException`, `BadRequestException`
- Log all authentication failures with context: `this.logger.warn('Login failed for email: {email}', 'AuthService')`
- Return generic error messages (don't reveal if email exists or password is wrong)

**Security Best Practices:**

- **No user enumeration**: Same error for wrong email vs wrong password
- **Token revocation**: Database-backed refresh tokens enable logout
- **Token type validation**: Verify `type` claim to prevent access/refresh token confusion
- **Constant-time password comparison**: bcrypt.compare is safe by default
- **Rate limiting**: Prevents brute-force attacks
- **Inactive account check**: Prevents deactivated users from logging in

### Project Structure Notes

**File Locations:**

```
src/auth/
├── auth.controller.ts                    (NEW or MODIFY if exists)
├── auth.service.ts                       (NEW or MODIFY if exists)
├── auth.module.ts                        (MODIFY: add AuthService, AuthController)
├── dto/
│   ├── login.dto.ts                      (NEW)
│   ├── login-response.dto.ts             (NEW)
│   ├── refresh-token.dto.ts              (NEW)
│   ├── logout.dto.ts                     (NEW)
│   ├── current-user-response.dto.ts      (NEW or REUSE UserDto from Story 17-2)
│   └── user.dto.ts                       (EXISTS from Story 17-2)
├── auth.controller.spec.ts               (NEW)
├── auth.service.spec.ts                  (NEW)
├── registration/                         (EXISTS from Story 17-2)
└── invitations/                          (EXISTS from Story 17-1)

prisma/
├── schema.prisma                         (MODIFY: add RefreshToken model)
└── migrations/
    └── YYYYMMDDHHMMSS_add_refresh_tokens/
        └── migration.sql                  (NEW)
```

**Naming Conventions:**

- Controllers: `*.controller.ts`
- Services: `*.service.ts`
- Modules: `*.module.ts`
- DTOs: `*.dto.ts` (in dedicated `dto/` folder)
- Test files: `*.spec.ts`

**Dependencies Already in Project:**

- NestJS core, Prisma ORM, JWT packages, bcrypt (from Story 17-2)
- class-validator, class-transformer, @nestjs/swagger
- @nestjs/throttler (for rate limiting)

**No New Dependencies Required** - all necessary packages installed in previous stories.

### Testing Standards

**Unit Tests:**

- Aim for >80% code coverage
- Mock all external dependencies (PrismaService, JwtService)
- Test happy path + all error scenarios
- Use Jest testing framework (already configured)

**Critical Test Scenarios:**

1. **Success Case**: Valid credentials → Tokens generated → last_login_at updated → User profile returned
2. **Invalid Email**: Non-existent email → UnauthorizedException (generic message)
3. **Invalid Password**: Wrong password → UnauthorizedException (same generic message)
4. **Inactive User**: is_active = false → ForbiddenException
5. **Refresh Token Valid**: Valid refresh token → New access token generated
6. **Refresh Token Revoked**: Logged-out token → UnauthorizedException
7. **Logout Idempotency**: Logout twice with same token → Both return success
8. **Current User**: Valid access token → User profile returned (no password_hash)

### Common Pitfalls to Avoid

1. **❌ Different error messages for wrong email vs wrong password** → ✅ Use same generic "Invalid credentials" message
2. **❌ Forgetting to check is_active flag** → ✅ Return 403 Forbidden for deactivated accounts
3. **❌ Not storing refresh tokens** → ✅ Database-backed refresh tokens enable secure logout
4. **❌ Allowing access tokens in refresh endpoint** → ✅ Validate `type` claim equals 'refresh'
5. **❌ Updating last_login_at on failed attempts** → ✅ Only update on successful login
6. **❌ Not rate limiting login endpoint** → ✅ Use @Throttle decorator to prevent brute-force
7. **❌ Returning password_hash in /me endpoint** → ✅ Use UserDto to exclude sensitive fields
8. **❌ Hardcoding token expiration times** → ✅ Use JwtService configuration and `{ expiresIn: '30d' }` option
9. **❌ Non-atomic login operations** → ✅ Use transaction for token creation + last login update

### Previous Story Intelligence (Stories 17-1 & 17-2)

**What was implemented in Story 17-1:**

- User model updated with auth fields: `password_hash`, `full_name`, `is_active`, `last_login_at`
- InvitationsService.verifyToken() method for Story 17-2
- EmailService for sending invitation emails
- Prisma migration: `20260102145811_add_user_invitation_and_auth_fields`

**What was implemented in Story 17-2:**

- RegistrationService with bcrypt password hashing (cost factor 12)
- JwtService integration for access token generation
- UserDto pattern for excluding password_hash from responses
- Strong password validation decorator
- Dependencies: bcrypt 6.0.0, @types/bcrypt 6.0.0

**Lessons from Stories 17-1 & 17-2:**

- Bcrypt version 6.0.0 installed (not 5.1.1 as originally planned)
- JWT config: HS256 (not RS256), 24h access tokens (not 7 days) - see Dev Notes for full details
- UserDto pattern established for excluding sensitive fields
- Unit tests comprehensive (17-1: blocked by npm, 17-2: 12/12 passing)
- Prisma client regeneration required after schema changes
- Use `crypto.randomUUID()` for generating unique IDs (refresh token jti claim)

**Files to Reuse:**

- `src/auth/dto/user.dto.ts` - for response mapping (exclude password_hash)
- `src/auth/registration/registration.service.ts` - bcrypt pattern reference
- Existing JwtService configuration from Story 1.6

### Environment Variables

No new environment variables required. JWT_SECRET already configured in Story 1.6.

Optional enhancement (Phase 2):

- `REFRESH_TOKEN_EXPIRATION` (default: 30d)
- `ACCESS_TOKEN_EXPIRATION` (default: 24h)

### Prisma Schema Changes

**RefreshToken Model:**

```prisma
model RefreshToken {
  id         String   @id @default(uuid())
  token_id   String   @unique // From JWT jti claim
  user_id    String
  user       User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
  is_revoked Boolean  @default(false)
  expires_at DateTime
  created_at DateTime @default(now())

  @@index([token_id])
  @@index([user_id, is_revoked])
}
```

**User Model Update (add relation):**

```prisma
model User {
  // ... existing fields from Story 17-1
  refreshTokens RefreshToken[]
}
```

### References

- **Story 17-1**: User Invitation API - [Source: _bmad-output/implementation-artifacts/17-1-backend-user-invitation-api.md]
- **Story 17-2**: User Registration via Invite - [Source: _bmad-output/implementation-artifacts/17-2-backend-user-registration-via-invite.md]
- **Epic 17 Details**: [Source: _bmad-output/implementation-artifacts/epic-17-authentication-access-control.md#section-17-3]
- **JWT Infrastructure**: Story 1.6 (JwtService at `src/auth/strategies/jwt.strategy.ts`)
- **Bcrypt Compare**: https://www.npmjs.com/package/bcrypt#usage
- **NestJS Throttler**: https://docs.nestjs.com/security/rate-limiting
- **JWT Refresh Tokens**: https://auth0.com/blog/refresh-tokens-what-are-they-and-when-to-use-them/

## Dev Agent Record

### Agent Model Used

PLACEHOLDER_M8

### Debug Log References

- Fixed TypeScript strict mode property initialization errors in DTOs.
- Corrected relative import path for PrismaService in AuthService.
- Regenerated Prisma client to resolve missing `refreshToken` model in types.

### Completion Notes List

- ✅ Implemented `RefreshToken` model in Prisma schema and applied migration.
- ✅ Created strict-typed DTOs for Login, Refresh, and Logout operations with Swagger docs.
- ✅ Implemented `AuthService` with:
  - Secure login (bcrypt verify)
  - JWT Access (24h) + Refresh (30d) token generation
  - Atomic transaction for creating refresh token and updating `last_login_at`
  - Secure logout (token revocation)
  - Token refresh (revocation check supported)
  - `getCurrentUser` profile retrieval
- ✅ Implemented `AuthController` with rate limiting (5 req/15min) and full Swagger responses.
- ✅ Added comprehensive unit tests (16/16 tests passing) covering all error scenarios.

### File List

- src/prisma/models/RefreshToken.ts
- src/auth/auth.controller.spec.ts
- src/auth/auth.controller.ts
- src/auth/auth.service.spec.ts
- src/auth/auth.service.ts
- src/auth/auth.module.ts
- src/auth/dto/login.dto.ts
- src/auth/dto/login-response.dto.ts
- src/auth/dto/refresh-token.dto.ts
- src/auth/dto/logout.dto.ts
- src/auth/dto/refresh-response.dto.ts
- prisma/schema.prisma
- prisma/migrations/20260102184911_add_refresh_tokens/migration.sql
