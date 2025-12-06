# Story 5.8: Client Communication Log - Implementation Playbook

**Epic:** 5 - PM Dashboard & Project Orchestration  
**Priority:** Phase 1 (High PM Value)  
**Effort Reduction:** ~60% (5 days → 2 days)  
**Status:** Ready for implementation when Epic 5 becomes active

---

## Overview

### Original Approach (Don't Do This)
❌ Build transcription API integration (Whisper, Rev, Otter.ai)  
❌ Build NLP summarization service  
❌ Build action item extraction logic  
❌ Build sentiment analysis engine  
❌ ~200 lines of complex NLP/API integration

### Delegation Approach (Do This Instead)
✅ AI handles transcription → summary → action extraction → sentiment  
✅ Orchestrator stores results and links to projects  
✅ UI displays analyzed conversation data  
✅ ~40 lines of storage/display logic

**Key Insight:** AI natively excels at NLP tasks - let it do what it does best!

---

## Implementation Steps

### Step 1: Create Conversation Interface

**File:** `src/modules/client-communication/interfaces/conversation.interface.ts`

```typescript
export interface ConversationAnalysisTask {
  type: 'meeting-transcription-analysis';
  instructions: string;
  context: {
    transcriptText?: string;      // Raw transcript from meeting
    transcriptFile?: string;       // Or audio file path for transcription
    meetingDate: Date;
    attendees: string[];
    projectId: string;
    meetingTitle: string;
  };
}

export interface ConversationAnalysisResult {
  summary: string;                 // Executive summary (3-5 bullet points)
  keyPoints: string[];             // Important discussion points
  actionItems: ActionItem[];       // Extracted action items
  ticketCandidates: TicketCandidate[]; // Potential tickets to create
  sentiment: SentimentAnalysis;    // Client satisfaction assessment
  decisions: string[];             // Decisions made during meeting
  followUpTopics: string[];        // Topics needing follow-up
}

export interface ActionItem {
  description: string;
  owner: string;                   // Who's responsible
  deadline?: string;               // Due date if mentioned
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
}

export interface TicketCandidate {
  title: string;
  description: string;
  estimatedComplexity: 'SIMPLE' | 'MODERATE' | 'COMPLEX';
  suggestedPriority: 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
  reasoning: string;               // Why this should be a ticket
}

export interface SentimentAnalysis {
  overall: 'SATISFIED' | 'NEUTRAL' | 'CONCERNED' | 'FRUSTRATED';
  confidence: number;              // 0-100
  indicators: string[];            // Phrases that indicated sentiment
  concerns: string[];              // Any client concerns raised
}
```

---

### Step 2: Create Conversation Analysis Service

**File:** `src/modules/client-communication/services/conversation-analysis.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { AIProviderService } from '@/modules/ai-routing/services/ai-provider.service';
import { ConversationAnalysisResult } from '../interfaces/conversation.interface';

@Injectable()
export class ConversationAnalysisService {
  constructor(
    private readonly aiProvider: AIProviderService
  ) {}

  async analyzeConversation(
    transcriptText: string,
    meetingContext: {
      date: Date;
      attendees: string[];
      projectId: string;
      title: string;
    }
  ): Promise<ConversationAnalysisResult> {
    const analysisTask = {
      type: 'meeting-transcription-analysis',
      instructions: this.buildAnalysisPrompt(transcriptText, meetingContext),
      context: meetingContext
    };

    const result = await this.aiProvider.execute(analysisTask);
    return this.parseAnalysisResult(result.output);
  }

  private buildAnalysisPrompt(transcript: string, context: any): string {
    return `
Analyze this client meeting transcript and extract structured information:

**Meeting Details:**
- Date: ${context.date.toISOString().split('T')[0]}
- Attendees: ${context.attendees.join(', ')}
- Project: ${context.projectId}
- Title: ${context.title}

**Transcript:**
${transcript}

**Your Task:**
Extract the following information and return as JSON:

1. **Summary:** 3-5 bullet point executive summary of the meeting
2. **Key Points:** Important discussion points (array of strings)
3. **Action Items:** Tasks that were assigned with:
   - description
   - owner (person responsible)
   - deadline (if mentioned, format: YYYY-MM-DD)
   - priority (HIGH/MEDIUM/LOW based on urgency)
4. **Ticket Candidates:** Items that should become development tickets:
   - title (brief, descriptive)
   - description (detailed requirements)
   - estimatedComplexity (SIMPLE/MODERATE/COMPLEX)
   - suggestedPriority (URGENT/HIGH/NORMAL/LOW)
   - reasoning (why this should be a ticket)
5. **Sentiment:** Client's overall sentiment:
   - overall (SATISFIED/NEUTRAL/CONCERNED/FRUSTRATED)
   - confidence (0-100)
   - indicators (phrases showing sentiment)
   - concerns (any issues client raised)
6. **Decisions:** Decisions made during the meeting
7. **Follow-up Topics:** Topics needing future discussion

**JSON Format:**
{
  "summary": "...",
  "keyPoints": ["...", "..."],
  "actionItems": [{
    "description": "...",
    "owner": "...",
    "deadline": "2025-12-15",
    "priority": "HIGH"
  }],
  "ticketCandidates": [{
    "title": "...",
    "description": "...",
    "estimatedComplexity": "MODERATE",
    "suggestedPriority": "HIGH",
    "reasoning": "..."
  }],
  "sentiment": {
    "overall": "SATISFIED",
    "confidence": 85,
    "indicators": ["excited about features", "happy with progress"],
    "concerns": ["timeline slightly tight"]
  },
  "decisions": ["..."],
  "followUpTopics": ["..."]
}
    `.trim();
  }

  private parseAnalysisResult(aiOutput: string): ConversationAnalysisResult {
    try {
      const parsed = JSON.parse(aiOutput);
      return {
        summary: parsed.summary || '',
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        actionItems: this.parseActionItems(parsed.actionItems || []),
        ticketCandidates: Array.isArray(parsed.ticketCandidates) 
          ? parsed.ticketCandidates 
          : [],
        sentiment: parsed.sentiment || {
          overall: 'NEUTRAL',
          confidence: 50,
          indicators: [],
          concerns: []
        },
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        followUpTopics: Array.isArray(parsed.followUpTopics) 
          ? parsed.followUpTopics 
          : []
      };
    } catch (error) {
      throw new Error(`Failed to parse AI analysis: ${error.message}`);
    }
  }

  private parseActionItems(items: any[]): ActionItem[] {
    return items.map(item => ({
      description: item.description || '',
      owner: item.owner || 'Unassigned',
      deadline: item.deadline || undefined,
      priority: item.priority || 'MEDIUM',
      status: 'PENDING'
    }));
  }
}
```

---

### Step 3: Update Database Schema

**File:** `prisma/schema.prisma`

```prisma
model ClientConversation {
  id          String   @id @default(cuid())
  
  // Meeting Details
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id])
  pmId        String   // PM who logged conversation
  pm          User     @relation(fields: [pmId], references: [id])
  
  meetingTitle String
  meetingDate  DateTime
  duration     Int?     // Minutes
  attendees    String[] // Array of attendee names
  
  // Transcript
  transcriptText String? @db.Text
  transcriptFileUrl String? // S3/storage URL if uploaded
  
  // AI Analysis Results (stored as JSON)
  summary      String   @db.Text
  keyPoints    String[] // Array of key discussion points
  actionItems  Json     // ActionItem[] serialized
  ticketCandidates Json // TicketCandidate[] serialized
  sentiment    Json     // SentimentAnalysis serialized
  decisions    String[] // Decisions made
  followUpTopics String[] // Topics for next meeting
  
  // Metadata
  tags         String[] // e.g., ["requirements", "feedback", "escalation"]
  linkedTicketIds String[] // Tickets created from this conversation
  
  // Timestamps
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  @@index([projectId])
  @@index([pmId])
  @@index([meetingDate])
}
```

---

### Step 4: Create Repository

**File:** `src/modules/client-communication/repositories/conversation.repository.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ConversationAnalysisResult } from '../interfaces/conversation.interface';

@Injectable()
export class ConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createConversation(data: {
    projectId: string;
    pmId: string;
    meetingTitle: string;
    meetingDate: Date;
    attendees: string[];
    transcriptText: string;
    analysis: ConversationAnalysisResult;
    tags?: string[];
  }) {
    return this.prisma.clientConversation.create({
      data: {
        projectId: data.projectId,
        pmId: data.pmId,
        meetingTitle: data.meetingTitle,
        meetingDate: data.meetingDate,
        attendees: data.attendees,
        transcriptText: data.transcriptText,
        summary: data.analysis.summary,
        keyPoints: data.analysis.keyPoints,
        actionItems: data.analysis.actionItems,
        ticketCandidates: data.analysis.ticketCandidates,
        sentiment: data.analysis.sentiment,
        decisions: data.analysis.decisions,
        followUpTopics: data.analysis.followUpTopics,
        tags: data.tags || []
      }
    });
  }

  async getConversationsForProject(
    projectId: string,
    options?: {
      limit?: number;
      startDate?: Date;
      endDate?: Date;
    }
  ) {
    return this.prisma.clientConversation.findMany({
      where: {
        projectId,
        ...(options?.startDate && {
          meetingDate: { gte: options.startDate }
        }),
        ...(options?.endDate && {
          meetingDate: { lte: options.endDate }
        })
      },
      orderBy: { meetingDate: 'desc' },
      take: options?.limit || 50
    });
  }

  async searchConversations(query: string, projectId?: string) {
    return this.prisma.clientConversation.findMany({
      where: {
        ...(projectId && { projectId }),
        OR: [
          { summary: { contains: query, mode: 'insensitive' } },
          { transcriptText: { contains: query, mode: 'insensitive' } },
          { keyPoints: { has: query } },
          { tags: { has: query } }
        ]
      },
      orderBy: { meetingDate: 'desc' }
    });
  }
}
```

---

### Step 5: Create API Endpoint

**File:** `src/modules/client-communication/controllers/conversation.controller.ts`

```typescript
import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ConversationAnalysisService } from '../services/conversation-analysis.service';
import { ConversationRepository } from '../repositories/conversation.repository';

@Controller('api/v1/conversations')
export class ConversationController {
  constructor(
    private readonly analysisService: ConversationAnalysisService,
    private readonly conversationRepo: ConversationRepository
  ) {}

  @Post()
  async logConversation(@Body() dto: {
    projectId: string;
    pmId: string;
    meetingTitle: string;
    meetingDate: string;
    attendees: string[];
    transcriptText: string;
    tags?: string[];
  }) {
    // Analyze conversation with AI
    const analysis = await this.analysisService.analyzeConversation(
      dto.transcriptText,
      {
        date: new Date(dto.meetingDate),
        attendees: dto.attendees,
        projectId: dto.projectId,
        title: dto.meetingTitle
      }
    );

    // Store in database
    const conversation = await this.conversationRepo.createConversation({
      ...dto,
      meetingDate: new Date(dto.meetingDate),
      analysis
    });

    return {
      conversationId: conversation.id,
      analysis,
      message: 'Conversation logged and analyzed successfully'
    };
  }

  @Get('project/:projectId')
  async getProjectConversations(
    @Param('projectId') projectId: string,
    @Query('limit') limit?: number
  ) {
    return this.conversationRepo.getConversationsForProject(projectId, {
      limit: limit ? parseInt(limit.toString()) : 50
    });
  }

  @Get('search')
  async searchConversations(
    @Query('q') query: string,
    @Query('projectId') projectId?: string
  ) {
    return this.conversationRepo.searchConversations(query, projectId);
  }
}
```

---

## Frontend Integration (PM Dashboard)

### Display Conversation Analysis

**Component:** `ConversationCard.tsx`

```typescript
interface ConversationCardProps {
  conversation: ClientConversation;
  onCreateTicket: (candidate: TicketCandidate) => void;
}

export function ConversationCard({ conversation, onCreateTicket }: ConversationCardProps) {
  const sentiment = conversation.sentiment as SentimentAnalysis;
  
  return (
    <Card>
      <CardHeader>
        <h3>{conversation.meetingTitle}</h3>
        <Badge variant={getSentimentVariant(sentiment.overall)}>
          {sentiment.overall}
        </Badge>
      </CardHeader>
      
      <CardContent>
        {/* Summary */}
        <section>
          <h4>Summary</h4>
          <p>{conversation.summary}</p>
        </section>
        
        {/* Action Items */}
        <section>
          <h4>Action Items ({conversation.actionItems.length})</h4>
          {conversation.actionItems.map((item, i) => (
            <ActionItemRow key={i} item={item} />
          ))}
        </section>
        
        {/* Ticket Candidates */}
        {conversation.ticketCandidates.length > 0 && (
          <section>
            <h4>Suggested Tickets</h4>
            {conversation.ticketCandidates.map((candidate, i) => (
              <TicketCandidateCard
                key={i}
                candidate={candidate}
                onCreate={() => onCreateTicket(candidate)}
              />
            ))}
          </section>
        )}
        
        {/* Client Concerns */}
        {sentiment.concerns.length > 0 && (
          <Alert variant="warning">
            <h4>Client Concerns</h4>
            <ul>
              {sentiment.concerns.map((concern, i) => (
                <li key={i}>{concern}</li>
              ))}
            </ul>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
```

---

## What We Didn't Build (Effort Saved)

### ❌ Transcription Integration (~1 day)
```typescript
// DON'T NEED THIS - AI handles transcription
class TranscriptionService {
  async transcribe(audioFile: Buffer): Promise<string> {
    // Whisper API integration
    // Audio format conversion
    // Error handling for API failures
    // ~100 lines
  }
}
```

### ❌ NLP Summarization (~2 days)
```typescript
// DON'T NEED THIS - AI generates summaries
class SummarizationService {
  async generateSummary(text: string): Promise<string> {
    // Extractive or abstractive summarization
    // Sentence scoring
    // Key phrase extraction
    // ~150 lines
  }
}
```

### ❌ Action Item Extraction (~1 day)
```typescript
// DON'T NEED THIS - AI extracts action items
class ActionItemExtractor {
  async extract(text: string): Promise<ActionItem[]> {
    // Regex patterns for common action phrases
    // Owner detection (names, roles)
    // Deadline parsing (date extraction)
    // ~80 lines
  }
}
```

**Total Saved:** ~4 days of NLP/API development

---

## Success Metrics

### Quantitative
- **Extraction Accuracy:** % of action items correctly identified (target: >85%)
- **Sentiment Accuracy:** Agreement with PM's assessment (target: >80%)
- **Ticket Conversion:** % of ticket candidates actually created (track value)
- **Time per Meeting:** AI analysis time (target: <30 seconds)

### Qualitative
- **PM Satisfaction:** Survey: "Analysis quality useful?" (1-5 scale)
- **Comprehensiveness:** "Anything AI missed?" feedback
- **Actionability:** Did suggestions lead to actual tickets/actions?

---

## Common Issues & Solutions

### Issue 1: Poor Transcription Quality
**Solution:** Provide context in prompt:
```typescript
const prompt = `
Meeting was about: ${meetingContext.topic}
Attendees work on: ${projectDescription}
Industry jargon: ${industryTerms.join(', ')}

Now analyze this transcript...
`;
```

### Issue 2: Missed Action Items
**Solution:** Be explicit about what constitutes an action:
```
An action item is ANY task mentioned where:
- Someone commits to doing something
- Follow-up is required
- Decision needs implementation
```

### Issue 3: Inaccurate Sentiment
**Solution:** Ask for evidence:
```
For sentiment, cite specific phrases:
- SATISFIED: "excited", "love it", "great progress"
- CONCERNED: "worried", "tight timeline", "need more resources"
```

---

## Integration with Ticket Creation

**Auto-create tickets from candidates:**

```typescript
class TicketService {
  async createFromConversationCandidate(
    candidate: TicketCandidate,
    conversationId: string,
    projectId: string
  ) {
    return this.ticketRepository.create({
      title: candidate.title,
      description: `
${candidate.description}

**Source:** Client conversation on ${conversationDate}
**Context:** ${candidate.reasoning}
**Estimated Complexity:** ${candidate.estimatedComplexity}
      `.trim(),
      priority: candidate.suggestedPriority,
      projectId,
      sourceConversationId: conversationId,
      tags: ['client-request', 'from-meeting']
    });
  }
}
```

---

## Phase 1 Checklist

- [ ] Conversation interfaces defined
- [ ] Analysis service created with AI delegation
- [ ] Database schema with conversation table
- [ ] Repository with CRUD operations
- [ ] API endpoints (create, list, search)
- [ ] PM dashboard displays conversations
- [ ] Sentiment indicators visually clear
- [ ] One-click ticket creation from candidates
- [ ] Search functionality (by keyword, date, project)
- [ ] Success metrics tracked (accuracy, usage)
- [ ] Unit tests for parser (>80% coverage)
- [ ] Integration test with AI provider
- [ ] Documentation updated

---

**Status:** Ready for implementation when Epic 5 becomes active!  
**Estimated Effort:** 2 days (vs. original 5 days)  
**ROI:** 60% time savings + much richer analysis than basic transcription
