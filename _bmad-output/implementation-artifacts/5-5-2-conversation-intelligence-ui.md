# Story 5.5.2: Conversation Intelligence UI (PM Dashboard)

**Status:** ready-for-dev  
**Parent Story:** 5.5 (Client Communication Intelligence)  
**Created:** 2025-12-27  
**Priority:** High  
**Type:** Frontend / UI  
**Repository:** `dsf-dashboard` (React + TypeScript + Tailwind)

## Story
**As a PM,**  
I want a user-friendly interface to upload meeting audio, view AI-generated insights, and approve action items for ticket creation,  
So that I can efficiently manage client conversation intelligence without manually transcribing or organizing notes.

## Context

**Parent Story 5.5** delivered the **backend API** for conversation intelligence (audio upload, Whisper transcription, GPT-4 analysis, action item extraction). However, the **frontend UI components** were marked as "delegated to AI" without an actual implementation story.

This story creates the **PM Dashboard UI** in the `dsf-dashboard` repository to provide PMs with:
1. **Upload Interface** - Drag-and-drop audio files or paste transcripts
2. **Conversation View** - Display transcripts, AI summaries, sentiment, action items
3. **Search Interface** - Full-text search across conversations
4. **Action Item Approval** - Select action items to create ClickUp tickets
5. **List Widget** - Recent conversations widget for dashboard

---

## Acceptance Criteria

- [x] **AC#1:** ConversationUploadForm component allows PMs to upload audio files
  - Drag-and-drop zone for audio files (mp3, wav, m4a, mp4)
  - Max file size: 25 MB (enforced client-side with visual warning)
  - Project selector dropdown (fetches from `/api/projects`)
  - Optional title input (auto-filled with "Meeting - {date}" if empty)
  - Alternative: "Paste Transcript" tab for manual text input
  - "Process with AI" button triggers upload + analysis
  - Loading states: "Uploading...", "Transcribing...", "Analyzing..."
  - Success: Redirect to ConversationDetailView
  - Error handling: Display API errors (e.g., "Audio file too large", "Project not found")

- [x] **AC#2:** ConversationDetailView displays AI-generated insights
  - **Header:** Title, date, project name, PM name, sentiment badge (color-coded)
  - **Audio Player:** HTML5 audio element (if audio_file_url exists)
  - **Transcript Section:** Expandable text area with "Copy" button
  - **AI Summary Box** (highlighted card):
    - Key Points (bullet list)
    - Decisions Made (bullet list)
    - Next Steps (bullet list)
  - **Action Items Table:**
    - Columns: Checkbox, Task, Owner, Due Date, Priority
    - Checkbox selection for ticket creation
    - "Create Tickets" button (calls Story 5-5-1 integration)
  - **Processing Cost:** Display at bottom (e.g., "$0.18 AI processing cost")
  - **Status Badge:** Show conversation status (uploading, transcribing, analyzing, completed, failed)

- [x] **AC#3:** ConversationSearchInterface enables full-text search
  - Search bar with placeholder: "Search conversations by keyword..."
  - Filter dropdowns:
    - Project (multi-select)
    - Sentiment (positive, neutral, negative)
    - Date Range (from/to date pickers)
  - "Search" and "Clear Filters" buttons
  - Results grid (card layout):
    - Each card shows: Title, date, project, sentiment, snippet (first 100 chars of summary)
    - Click card → Navigate to ConversationDetailView
  - Pagination: "Load More" button or infinite scroll
  - Empty state: "No conversations found. Try different filters."

- [x] **AC#4:** ConversationListWidget shows recent conversations on PM Dashboard
  - Displays 5 most recent conversations for the logged-in PM
  - Each row: Title, project name, date, sentiment icon
  - Click row → Navigate to ConversationDetailView
  - "View All" link → Navigate to ConversationSearchInterface
  - Loading skeleton while fetching

- [x] **AC#5:** Action item approval flow creates ClickUp tickets
  - PM selects checkboxes on action items
  - "Create Tickets" button enabled when ≥1 item selected
  - Click "Create Tickets" → Modal opens:
    - "Create {count} tickets in ClickUp?"
    - ClickUp list selector (fetched from AetherFlow integration)
    - "Confirm" and "Cancel" buttons
  - On confirm → API call to `/api/v1/conversations/{id}/create-tickets`
  - Success toast: "✅ {count} tickets created successfully! [View in ClickUp]"
  - Error toast: "❌ Failed to create tickets: {error}"

- [x] **AC#6:** UI follows design system and is responsive
  - Uses `shadcn/ui` components (Button, Card, Badge, Input, Select, Toast)
  - Tailwind CSS for styling
  - Responsive: Mobile (stack vertically), Tablet, Desktop (side-by-side)
  - Dark mode support (if design system has it)
  - Accessibility: ARIA labels, keyboard navigation, screen reader friendly

---

## Tasks

### Component Development

#### 1. ConversationUploadForm Component
- [ ] Create `components/conversations/ConversationUploadForm.tsx`
  - File upload zone with `react-dropzone` or native HTML5
  - Project selector (fetch from `/api/projects`)
  - Title input with auto-fill logic
  - Tabs: "Upload Audio" vs "Paste Transcript"
  - Form validation (Zod schema)
  - Upload progress bar
- [ ] Create upload API integration in `lib/api/conversations.ts`
  - `uploadConversationAudio(file, projectId, title)` → FormData POST
  - `createConversationFromTranscript(transcript, projectId, title)` → JSON POST
- [ ] Handle loading states:
  - Step 1: "Uploading..." (file upload progress)
  - Step 2: "Transcribing..." (Whisper processing)
  - Step 3: "Analyzing..." (GPT-4 processing)
  - Poll `/api/v1/conversations/{id}` until status = 'completed' or 'failed'
- [ ] Error handling:
  - Client-side validation (file size, format)
  - API error display (toast notifications)
  - Retry button for failed uploads

#### 2. ConversationDetailView Component
- [ ] Create `components/conversations/ConversationDetailView.tsx`
  - Header section (title, date, project, PM, sentiment)
  - Audio player (`<audio>` element with controls)
  - Transcript section (collapsible, copy button)
  - AI Summary card (key points, decisions, next steps)
  - Action Items table with checkboxes
  - "Create Tickets" button
- [ ] Sentiment badge component:
  - `positive` → Green badge with 😊
  - `neutral` → Gray badge with 😐
  - `negative` → Red badge with 😟
- [ ] Action Items table:
  - Checkbox column (multi-select)
  - Task, Owner, Due Date, Priority columns
  - Sort by priority (high → low)
  - Selected count indicator: "{count} selected"
- [ ] Create tickets modal:
  - ClickUp list selector (fetch from AetherFlow API)
  - Confirm/Cancel buttons
  - API call to `/api/v1/conversations/{id}/create-tickets`
- [ ] Processing cost display (bottom of page)

#### 3. ConversationSearchInterface Component
- [ ] Create `components/conversations/ConversationSearchInterface.tsx`
  - Search input with debounce (500ms)
  - Filter controls:
    - Project multi-select (fetch from `/api/projects`)
    - Sentiment dropdown (positive, neutral, negative, all)
    - Date range pickers (from/to)
  - "Search" and "Clear Filters" buttons
- [ ] Results grid:
  - Card layout (responsive grid: 1 col mobile, 2 col tablet, 3 col desktop)
  - Each card: Title, date, project, sentiment badge, summary snippet
  - Click → Navigate to `/conversations/{id}`
- [ ] Pagination:
  - "Load More" button (append results)
  - Or infinite scroll with `react-intersection-observer`
- [ ] Empty state illustration

#### 4. ConversationListWidget Component (Dashboard)
- [ ] Create `components/dashboard/ConversationListWidget.tsx`
  - Widget card with title: "Recent Conversations"
  - Fetch `/api/v1/conversations?limit=5` (filtered by current PM)
  - List view:
    - Each row: icon, title, project, date, sentiment icon
    - Click → Navigate to detail view
  - "View All" link → Navigate to search page
  - Loading skeleton

### API Integration

- [ ] Create `lib/api/conversations.ts`:
  ```typescript
  export async function uploadConversationAudio(
    file: File,
    projectId: string,
    title?: string
  ): Promise<{ id: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', projectId);
    if (title) formData.append('title', title);
    
    return apiClient.post('/api/v1/conversations/upload', formData);
  }
  
  export async function createConversationFromTranscript(
    data: { transcript: string; project_id: string; conversation_date: string; title?: string }
  ): Promise<{ id: string }> {
    return apiClient.post('/api/v1/conversations', data);
  }
  
  export async function getConversation(id: string): Promise<ConversationResponseDto> {
    return apiClient.get(`/api/v1/conversations/${id}`);
  }
  
  export async function searchConversations(
    filters: SearchConversationsDto
  ): Promise<PaginatedConversationsResponseDto> {
    return apiClient.get('/api/v1/conversations/search', { params: filters });
  }
  
  export async function createTicketsFromActionItems(
    conversationId: string,
    actionItemIds: string[]
  ): Promise<{ message: string; count: number }> {
    return apiClient.post(`/api/v1/conversations/${conversationId}/create-tickets`, {
      action_item_ids: actionItemIds
    });
  }
  ```

- [ ] TypeScript types (mirror backend DTOs):
  ```typescript
  export interface ConversationResponseDto {
    id: string;
    title: string;
    project_id: string;
    conversation_date: string;
    audio_file_url?: string;
    transcript?: string;
    summary?: string;
    action_items?: ActionItem[];
    sentiment?: 'positive' | 'neutral' | 'negative';
    status: 'uploaded' | 'transcribing' | 'analyzing' | 'completed' | 'failed';
    processing_cost?: number;
    pm: { id: string; name: string; email: string };
    project: { id: string; name: string };
    created_at: string;
    updated_at: string;
  }
  
  export interface ActionItem {
    id: string;
    owner: string;
    task: string;
    due_date: string;
    priority: 'high' | 'medium' | 'low';
  }
  ```

### Routing

- [ ] Add routes to `app/router.tsx` (or Next.js `/app` directory):
  - `/conversations` → ConversationSearchInterface
  - `/conversations/upload` → ConversationUploadForm
  - `/conversations/:id` → ConversationDetailView

### State Management

- [ ] React Query (or SWR) for data fetching:
  - `useConversation(id)` - Fetch single conversation
  - `useConversations(filters)` - Fetch list with filters
  - `useUploadConversation()` - Mutation for upload
  - `useCreateTickets()` - Mutation for ticket creation
- [ ] Optimistic updates for ticket creation

### Testing

#### Unit Tests (Jest + React Testing Library)
- [ ] `ConversationUploadForm.test.tsx`
  - Test file upload flow
  - Test transcript paste flow
  - Test validation errors
  - Test loading states
- [ ] `ConversationDetailView.test.tsx`
  - Test rendering with mock data
  - Test action item selection
  - Test create tickets button
- [ ] `ConversationSearchInterface.test.tsx`
  - Test search input
  - Test filters
  - Test results rendering

#### E2E Tests (Playwright or Cypress)
- [ ] Upload flow:
  1. Navigate to /conversations/upload
  2. Select project
  3. Upload audio file
  4. Wait for processing
  5. Verify redirect to detail view
- [ ] Ticket creation flow:
  1. Open conversation detail
  2. Select 2 action items
  3. Click "Create Tickets"
  4. Confirm modal
  5. Verify success toast

### Documentation
- [ ] Update PM Dashboard README with conversation features
- [ ] Add component Storybook stories (if applicable)
- [ ] Screenshot examples for design review

---

## Design Mockups

### ConversationUploadForm
```
┌─────────────────────────────────────────┐
│ Upload Client Conversation              │
├─────────────────────────────────────────┤
│ Project: [Select Project ▼]             │
│ Title: [Optional - auto-filled]         │
│                                          │
│ ┌─[ Upload Audio ]─┬─[ Paste Transcript]│
│ │                   │                    │
│ │  ┌──────────────┐│                    │
│ │  │   🎤 Drag    ││                    │
│ │  │   audio file ││                    │
│ │  │     here     ││                    │
│ │  │   or click   ││                    │
│ │  └──────────────┘│                    │
│ │  Formats: mp3, wav, m4a, mp4          │
│ │  Max: 25 MB                            │
│ │                                        │
│ │  [Process with AI]                    │
│ └───────────────────────────────────────┘
│                                          │
│ ⏳ Uploading... 47%                     │
└─────────────────────────────────────────┘
```

### ConversationDetailView
```
┌──────────────────────────────────────────────┐
│ Meeting with ABC Corp - Dec 26, 2025         │
│ Project: ABC Mobile App  |  PM: John Doe      │
│ Sentiment: 😊 Positive                        │
├──────────────────────────────────────────────┤
│ 🔊 [▶ Play Audio] 00:00 / 15:30              │
├──────────────────────────────────────────────┤
│ 📝 Transcript [Copy]                          │
│ The client expressed satisfaction with...    │
│ [Show More ▼]                                 │
├──────────────────────────────────────────────┤
│ 🤖 AI Summary                                 │
│ Key Points:                                   │
│ • Client approved new feature X              │
│ • Budget increased by 20%                     │
│                                               │
│ Decisions Made:                               │
│ • Use React Native instead of Flutter        │
│                                               │
│ Next Steps:                                   │
│ • Schedule architecture review               │
├──────────────────────────────────────────────┤
│ ✅ Action Items (3 selected)                  │
│ ┌─────────────────────────────────────────┐ │
│ │☑ Schedule architecture review next week │ │
│ │  Owner: Tech Lead  |  Due: Jan 2, 2025  │ │
│ │  Priority: High                          │ │
│ ├─────────────────────────────────────────┤ │
│ │☑ Update budget in ClickUp               │ │
│ │  Owner: PM  |  Due: Dec 28, 2024        │ │
│ │  Priority: High                          │ │
│ ├─────────────────────────────────────────┤ │
│ │☐ Send meeting notes to stakeholders     │ │
│ │  Owner: PM  |  Due: Dec 27, 2024        │ │
│ │  Priority: Medium                        │ │
│ └─────────────────────────────────────────┘ │
│                                               │
│ [Create Tickets (2)]                          │
│                                               │
│ Processing Cost: $0.18                        │
└──────────────────────────────────────────────┘
```

---

## Technical Stack

- **Framework:** React 18 + TypeScript
- **Styling:** Tailwind CSS
- **UI Components:** shadcn/ui (Button, Card, Badge, Input, Select, Toast, Modal)
- **File Upload:** `react-dropzone` or HTML5 native
- **Data Fetching:** React Query or SWR
- **Routing:** React Router or Next.js App Router
- **Forms:** React Hook Form + Zod validation
- **State:** React Context + hooks (or Zustand if needed)
- **Testing:** Jest + React Testing Library + Playwright/Cypress

---

## Dependencies
- **Parent Story:** 5.5 (Client Communication Intelligence API) - DONE
- **Related Story:** 5.5.1 (AetherFlow ClickUp Integration) - ready-for-dev
- **API Endpoints:** All 7 REST endpoints from Story 5.5

## Effort
- **Estimate:** 3 days
  - Components: 2 days (upload form, detail view, search, widget)
  - API integration + state management: 0.5 day
  - Testing + polish: 0.5 day

## Non-Functional Requirements
- **Performance (NFR-P2):** Page load <1 second, search results <2 seconds
- **Usability:** Mobile-friendly, keyboard accessible, screen reader support
- **Reliability:** Graceful error handling, offline detection, retry logic

---

## Future Enhancements (Out of Scope)
- Real-time collaboration on action items (multiple PMs viewing same conversation)
- Conversation export to PDF/Word
- Voice notes directly from browser microphone
- Conversation templates (standup, sprint review)
- Integration with calendar (auto-create conversation from meeting invites)

---

## Notes

**Design System:** Follow existing `dsf-dashboard` design patterns for consistency with:
- Story 5.1 (PM Dashboard)
- Story 5.2 (Real-Time Status)
- Story 5.3 (Code Approval)

**Accessibility:** Ensure WCAG 2.1 AA compliance for all interactive elements.
