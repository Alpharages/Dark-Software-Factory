# Story 5.5.1: AetherFlow ClickUp Integration

**Status:** ready-for-dev  
**Parent Story:** 5.5 (Client Communication Intelligence)  
**Created:** 2025-12-27  
**Priority:** Medium  
**Type:** Integration / Technical Debt Resolution

## Story
**As a PM,**  
I want action items from client conversations to create real ClickUp tickets via AetherFlow,  
So that conversation-derived tasks flow into our existing task management system with proper traceability.

## Context

**Parent Story 5.5** implemented client conversation intelligence with AI transcription and analysis. However, the ticket creation feature (AC#5) was left as a **stub** that only logs action items without creating actual ClickUp tickets.

**AetherFlow** is the Alpharages product specifically designed for ideas-to-execution workflow with a **production-ready ClickUp integration** (`lib/integrations/clickup-integration.ts`). It handles:
- OAuth-based multi-user ClickUp connections
- Epic/story/task creation with full metadata
- Space/List/Folder navigation
- Priority, tags, assignees, due dates
- Fuzzy list name matching

**Architectural Decision:** Rather than duplicate ClickUp integration in DSF, we integrate with AetherFlow's proven API.

---

## Acceptance Criteria

- [x] **AC#1:** AetherFlow exposes REST API endpoint `POST /api/integrations/clickup/create-tasks`
  - Accepts: `{ userId, listId or listName, tasks: [{ name, description, priority, tags }] }`
  - Returns: `{ success, tasks: [{ id, name, url }], error? }`
  - Requires authentication (shared secret or OAuth token)

- [x] **AC#2:** DSF creates HttpService client for AetherFlow API calls
  - Base URL configurable via `AETHERFLOW_API_URL` env variable
  - Authentication with `AETHERFLOW_API_KEY` shared secret
  - Timeout: 30 seconds
  - Retry logic: 3 attempts with exponential backoff

- [x] **AC#3:** DSF `ConversationsService.createTicketsFromActionItems()` calls AetherFlow API
  - Maps ActionItem[] to AetherFlow task format
  - Includes conversation context in task description
  - Links created ClickUp tasks back to conversation record
  - Stores ClickUp task IDs in ClientConversation or new ConversationTickets junction table

- [x] **AC#4:** Error handling for AetherFlow API failures
  - If AetherFlow unavailable → log error, notify PM via email/Slack, mark conversation as "tickets_pending"
  - If ClickUp not connected for user → return friendly error message
  - If invalid list name → return AetherFlow's list suggestions

- [x] **AC#5:** Metrics tracking for integration health
  - `aetherflow_api_calls_total` (counter) - labeled by endpoint, status
  - `aetherflow_api_duration_seconds` (histogram) - API response time
  - `conversation_tickets_created_total` (counter) - successful ticket creations
  - `conversation_ticket_creation_failures_total` (counter) - failures by reason

- [x] **AC#6:** Update Story 5.5 documentation and remove stub marker
  - Update `createTicketsFromActionItems()` implementation notes
  - Remove "TODO: Integrate with ClickUp service" comment
  - Document AetherFlow integration in architecture.md

---

## Tasks

### AetherFlow Changes (Minimal - API Exposure)

#### API Endpoint Creation
- [ ] Create `/app/api/integrations/clickup/create-tasks/route.ts` in AetherFlow
  - Use existing `createClickUpTasks()` function from `lib/integrations/clickup-integration.ts`
  - Add authentication middleware (API key validation)
  - Add request validation (Zod schema)
  - Return standardized response format
- [ ] Add `AETHERFLOW_API_KEY` to AetherFlow env validation
- [ ] Document endpoint in AetherFlow API docs

### DSF Changes (Primary Work)

#### HTTP Client Setup
- [ ] Create `src/integrations/aetherflow/aetherflow-client.service.ts`
  - HttpService wrapper with axios/fetch
  - Base URL from `AETHERFLOW_API_URL` env
  - Authentication header injection
  - Retry logic with exponential backoff (3 attempts, 1s/2s/4s)
  - Timeout: 30s
- [ ] Create DTOs:
  - `src/integrations/aetherflow/dto/create-tasks-request.dto.ts`
  - `src/integrations/aetherflow/dto/create-tasks-response.dto.ts`
- [ ] Create `src/integrations/aetherflow/aetherflow.module.ts`
  - Import HttpModule
  - Export AetherFlowClientService

#### Integration Implementation
- [ ] Update `src/conversations/conversations.service.ts`
  - Inject `AetherFlowClientService`
  - Replace stub in `createTicketsFromActionItems()`:
    ```typescript
    async createTicketsFromActionItems(conversationId, actionItemIds) {
      const conversation = await this.prisma.clientConversation.findUnique(...);
      const selectedItems = /* filter by IDs */;
      
      // Map to AetherFlow format
      const tasks = selectedItems.map(item => ({
        name: item.task,
        description: `From conversation: ${conversation.title}\n\n${item.task}\n\nDue: ${item.due_date}\nPriority: ${item.priority}`,
        priority: this.mapPriorityToClickUp(item.priority),
        tags: ['from-conversation', `conversation-${conversationId}`]
      }));
      
      // Call AetherFlow API
      const result = await this.aetherFlowClient.createTasks({
        userId: conversation.pm_id,
        listName: await this.getDefaultListForProject(conversation.project_id),
        tasks
      });
      
      if (result.success) {
        // Store ClickUp task IDs
        await this.linkClickUpTasksToConversation(conversationId, result.tasks);
        this.metrics.incrementTicketsCreatedFromConversations(result.tasks.length);
      } else {
        this.logger.error(`Failed to create tickets: ${result.error}`);
        this.sentry.captureMessage('AetherFlow ticket creation failed', {...});
        throw new BadRequestException(result.error);
      }
    }
    ```
- [ ] Add helper methods:
  - `mapPriorityToClickUp(priority: 'high'|'medium'|'low'): number` → 1-4 ClickUp priority
  - `getDefaultListForProject(projectId): Promise<string>` → fetch from Project table or config
  - `linkClickUpTasksToConversation(conversationId, tasks)` → store task IDs

#### Database Changes
- [ ] **Option A:** Add `clickup_task_ids` JSON field to `ClientConversation` table
- [ ] **Option B:** Create `ConversationTickets` junction table:
  ```prisma
  model ConversationTicket {
    id                  String   @id @default(uuid())
    conversation_id     String
    clickup_task_id     String
    clickup_task_url    String
    created_at          DateTime @default(now())
    
    conversation ClientConversation @relation(fields: [conversation_id], references: [id])
    @@unique([conversation_id, clickup_task_id])
  }
  ```
- [ ] Create Prisma migration
- [ ] Update `ClientConversation` model with relation

#### Configuration & Environment
- [ ] Add to `src/config/env.validation.ts`:
  ```typescript
  AETHERFLOW_API_URL: Joi.string()
    .uri()
    .required()
    .messages({
      'any.required': 'AETHERFLOW_API_URL required for ClickUp integration'
    }),
  AETHERFLOW_API_KEY: Joi.string()
    .min(32)
    .required()
    .messages({
      'any.required': 'AETHERFLOW_API_KEY required for AetherFlow authentication'
    }),
  AETHERFLOW_DEFAULT_CLICKUP_LIST: Joi.string()
    .optional()
    .description('Default ClickUp list name for conversation-derived tickets'),
  ```
- [ ] Update `.env.example`

#### Metrics Integration
- [ ] Add metrics to `src/common/metrics/metrics.service.ts`:
  ```typescript
  incrementAetherFlowApiCall(endpoint: string, status: string): void
  recordAetherFlowApiDuration(endpoint: string, duration: number): void
  incrementConversationTicketCreationFailure(reason: string): void
  ```
- [ ] Register metric providers in `AppMetricsModule`

#### Error Handling & Monitoring
- [ ] Add Sentry alerts for:
  - AetherFlow API unreachable (CRITICAL)
  - Repeated ticket creation failures (HIGH)
  - ClickUp authentication errors (MEDIUM)
- [ ] Add graceful degradation:
  - If AetherFlow down → queue action items for retry (deferred to future story)
  - Log to PM: "ClickUp ticket creation pending, will retry automatically"

### Testing

#### Unit Tests
- [ ] `aetherflow-client.service.spec.ts`
  - Test authentication header injection
  - Test retry logic (mock failed responses)
  - Test timeout handling
  - Test response parsing
- [ ] `conversations.service.spec.ts`
  - Test `createTicketsFromActionItems()` with mocked AetherFlow client
  - Test priority mapping
  - Test error handling (AetherFlow unavailable, invalid list)
  - Test ClickUp task ID storage

#### Integration Tests (Manual)
- [ ] End-to-end flow:
  1. Create conversation with action items
  2. Call `/api/v1/conversations/{id}/create-tickets`
  3. Verify tickets created in ClickUp
  4. Verify task IDs stored in ClientConversation
  5. Verify metrics incremented

### Documentation
- [ ] Update Story 5.5 completion notes
- [ ] Document integration in `docs/architecture.md`
- [ ] Add AetherFlow API endpoint to `docs/api-contracts.md`
- [ ] Update `README.md` with new env variables

---

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│  DSF (Dark Software Factory)            │
│  Story 5.5: Conversation Intelligence   │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ ConversationsService               │ │
│  │  - processAIAnalysis() ────────┐   │ │
│  │  - createTicketsFromActionItems│   │ │
│  └────────────┬───────────────────┘   │ │
│               │ calls                  │ │
│               ▼                        │ │
│  ┌────────────────────────────────────┐ │
│  │ AetherFlowClientService            │ │
│  │  - createTasks()                   │ │
│  │  - Retry logic                     │ │
│  │  - Auth: AETHERFLOW_API_KEY        │ │
│  └────────────┬───────────────────────┘ │
└───────────────┼─────────────────────────┘
                │ HTTP POST
                │ /api/integrations/clickup/create-tasks
                ▼
┌─────────────────────────────────────────┐
│  AetherFlow                              │
│  "Ideas to Execution" Platform           │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ POST /api/integrations/clickup/... │ │
│  │  - Validates API key               │ │
│  │  - Calls existing createClickUpTasks│ │
│  └────────────┬───────────────────────┘ │
│               ▼                        │ │
│  ┌────────────────────────────────────┐ │
│  │ lib/integrations/clickup-integration│ │
│  │  - createClickUpTasks()            │ │
│  │  - OAuth multi-user support        │ │
│  │  - Space/List navigation           │ │
│  └────────────┬───────────────────────┘ │
└───────────────┼─────────────────────────┘
                │ OAuth
                ▼
         ┌──────────────┐
         │   ClickUp    │
         │     API      │
         └──────────────┘
```

---

## Technical Decisions

**Q: Why AetherFlow instead of direct ClickUp integration in DSF?**
- A: Avoid duplication. AetherFlow has production-ready OAuth, multi-user support, error handling.
- Separation of concerns: AetherFlow = planning/tasks, DSF = AI execution.

**Q: Why shared API key instead of OAuth for DSF→AetherFlow?**
- A: Simpler for service-to-service communication. Both apps under same org control.
- OAuth would require DSF users to connect to AetherFlow (unnecessary complexity).

**Q: What if AetherFlow is down?**
- A: Current story logs error and fails gracefully. Future enhancement: Queue for retry.

**Q: Should we store full ClickUp task data or just IDs?**
- A: Just IDs + URLs. ClickUp is source of truth. Avoid data duplication.

---

## Dependencies
- **Parent Story:** 5.5 (Client Communication Intelligence) - DONE
- **AetherFlow:** `lib/integrations/clickup-integration.ts` already exists
- **Story 2-12:** File upload patterns (reused in 5.5)
- **Story 13-1:** Cost tracking (already integrated in 5.5)

## Effort
- **Estimate:** 1.5 days
  - AetherFlow API endpoint: 0.5 day
  - DSF integration: 0.75 day
  - Testing + documentation: 0.25 day

## Non-Functional Requirements
- **Performance (NFR-P2):** AetherFlow API call must complete <30 seconds
- **Reliability:** 3 retry attempts with exponential backoff
- **Security:** API key must be ≥32 characters, stored in env only
- **Observability:** All API calls logged with correlation IDs

---

## Future Enhancements (Out of Scope)
- Queue-based retry for failed ticket creations
- Bi-directional sync: Update conversation when ClickUp task status changes
- Bulk ticket creation optimization (currently creates one-by-one)
- Support for ClickUp custom fields (story points, sprint assignment)
