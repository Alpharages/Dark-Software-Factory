# Story 5.5: Client Communication Intelligence

**Status:** ready-to-start

## Story
**As a PM,**  
I want to log client conversations with AI transcription and analysis,  
So that I have searchable history with automatic action items and sentiment tracking.

## Formerly
- Original Story 5.8 (Client Communication Log)

## Acceptance Criteria
- [ ] **AC#1:** PMs can upload meeting audio/transcript and link to project.
- [ ] **AC#2:** AI generates summary of key points within 30 seconds.
- [ ] **AC#3:** AI extracts action items with suggested owners and due dates.
- [ ] **AC#4:** Sentiment analysis shows client satisfaction level (positive/neutral/negative).
- [ ] **AC#5:** Auto-generated tickets from action items require PM approval before creation.
- [ ] **AC#6:** Conversations are searchable by keyword, client, date, project, sentiment.

## Tasks

### Backend (DSF BUILDS)
- [ ] Create `client_conversations` table and relations.
- [ ] Implement API endpoints:
    - [ ] `POST /api/v1/conversations` (upload/create)
    - [ ] `POST /api/v1/conversations/{id}/link-project`
    - [ ] `GET /api/v1/conversations` (filterable/searchable)
- [ ] Implement file upload handling (transcripts/audio).
- [ ] Set up search indexing (Full-text search).

### AI DELEGATES (Heavy AI Integration)
- [ ] **Transcription:** Integrate Whisper API or similar.
- [ ] **Summarization:** Data to key points summary (GPT-4).
- [ ] **Action Item Extraction:** Context to action items.
- [ ] **Sentiment Analysis:** Tone analysis and satisfaction scoring.
- [ ] **Auto-Ticket Creation:** Action items to draft tickets.
- [ ] **Conversation UI:** Upload forms, transcript viewer, summary display.

## Dev Notes
- **Dependencies:** Epic 2 (Context extraction patterns).
- **FRs Covered:** FR20, FR23.
- **Effort:** 2.5 days.
- **Token Cost:** Estimate $0.50-$2.00 per meeting.
