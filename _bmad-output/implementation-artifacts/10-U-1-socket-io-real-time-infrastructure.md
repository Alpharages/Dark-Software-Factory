# Story 10-U-1: Socket.IO Real-Time Infrastructure

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **System Architect**,
I want to **establish a robust Socket.IO real-time infrastructure**,
so that **dashboard users receive instant updates on execution progress, costs, and quality metrics without manual refresh**.

## Acceptance Criteria

1.  **Socket.IO Server Initialization**
    - System must initialize a Socket.IO server at `/socket.io/` endpoint.
    * **Namespace:** Use `general` (or default) to distinguish from existing `execution` namespace.
    - CORS policies must be configured to allow connections from the frontend dashboard URL (configurable via env `FRONTEND_URL`).
    - Server must support upgrade from HTTP to WebSocket.
2.  **WebSocket Authentication**
    - Connections must be authenticated using the existing JWT infrastructure.
    - An `AuthGatewayGuard` must validate the `Authorization` header or query parameter during the handshake.
    - Invalid tokens must result in immediate disconnection with `401 Unauthorized`.
    - Authenticated user context (userId, roles) must be attached to the socket instance.
3.  **Room & Namespace Management**
    - System must support dynamic room joining based on Project ID (e.g., `project:{id}`).
    - System must support role-based rooms (e.g., `role:admin`, `role:pm`).
    - Users must only be allowed to subscribe to projects they have access to (RBAC check).
4.  **Event Emission Service**
    - A `RealtimeService` must be implemented to abstract the Socket.IO server.
    - Service must provide typed methods for emitting standard events: `execution.progress`, `ticket.updated`, `system.alert`.
    - Service must handle offline clients gracefully (fire-and-forget).
5.  **Connection Monitoring**
    - System must log connection/disconnection events with User ID and IP.
    - Prometheus metrics must track `active_connections`, `events_emitted_total`, and `connection_errors`.
    - Heartbeat mechanism must ensure stale connections are cleaned up.

## Tasks / Subtasks

- [ ] **Infrastructure Setup** (AC 1)
  - [ ] Install `@nestjs/platform-socket.io`, `@nestjs/websockets`, `socket.io`.
  - [ ] Create `RealtimeGateway` with `@WebSocketGateway()`.
  - [ ] Configure `cors` options based on environment variables.
  - [ ] Implement `OnGatewayInit`, `OnGatewayConnection`, `OnGatewayDisconnect` interfaces.
- [ ] **Authentication Architecture** (AC 2)
  - [ ] Create `WsAuthGuard` (or `AuthGatewayGuard`) extending `CanActivate`.
  - [ ] Implement token extraction from handshake query/headers.
  - [ ] Verify token using `AuthService` or `JwtService`.
  - [ ] Attach user payload to `client.data.user`.
- [ ] **Room Management Logic** (AC 3)
  - [ ] Implement `@SubscribeMessage('joinProject')` handler.
  - [ ] Validate user access to project (using `ProjectsService` or `CaslAbilityFactory` if available).
  - [ ] Use `client.join('project:{id}')`.
  - [ ] Implement `@SubscribeMessage('leaveProject')`.
- [ ] **Realtime Abstraction Layer** (AC 4)
  - [ ] Update `RealtimeModule` to export `RealtimeService`.
  - [ ] Implement `emitToProject(projectId, event, payload)` method.
  - [ ] Implement `emitToRole(role, event, payload)` method.
  - [ ] Implement `emitToUser(userId, event, payload)` method.
- [ ] **Observability & Monitoring** (AC 5)
  - [ ] Integrate `Logger` for connection events.
  - [ ] Register Prometheus Gauge `websocket_active_connections`.
  - [ ] Register Prometheus Counter `websocket_events_total`.
  - [ ] Implement instrumentation in Gateway hooks.

## Dev Notes

- **Architecture Compliance:**
  - Use `src/realtime` module.
  - **Namespace Strategy:**
    - `ExecutionGateway` (Story 5-2) already handles `namespace: 'execution'` for high-volume logs.
    - `RealtimeGateway` (this story) should use `namespace: 'general'` (or default `/`) for low-volume, high-value events (notifications, project updates, cost alerts).
  - Ensure strict separation: `RealtimeGateway` handles socket protocol, `RealtimeService` provides API for other modules.
  - Do **NOT** inject business services (like `ProjectsService`) into Gateway if it causes circular dependencies. Use `ModuleRef` or `forwardRef` if absolutely necessary, but prefer clean layering.
- **Security:**
  - WebSocket connections are essentially persistent open doors. Strict auth is non-negotiable.
  - Validate ALL inputs from clients using DTOs and `ValidationPipe`.
- **References:**
  - [Architecture Document: Real-Time Communication](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/architecture.md#Section-Real-Time-Communication)
  - [NestJS WebSockets](https://docs.nestjs.com/websockets/gateways)

### Project Structure Notes

- Module: `src/realtime/realtime.module.ts`
- Gateway: `src/realtime/realtime.gateway.ts`
- Service: `src/realtime/realtime.service.ts`
- Guards: `src/realtime/guards/ws-auth.guard.ts`
- DTOs: `src/realtime/dto/join-room.dto.ts`

### References

- [Architecture Doc](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/architecture.md)

## Dev Agent Record

### Agent Model Used

Antigravity (Google DeepMind)

### Debug Log References

- Verified `src/realtime` only contains `realtime.module.ts`.
- Confirmed `RealtimeGateway` does not currently exist.

### Completion Notes List

### File List
