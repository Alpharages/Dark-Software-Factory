# UX Design Specification: Dark Software Factory AI Orchestrator

**Project:** Dark Software Factory  
**Date:** 2025-11-27  
**Designer:** Sally (UX Designer)  
**User:** Khakanali  
**Version:** 1.0

---

## Executive Summary

The Dark Software Factory AI Orchestrator is a transformative web application that enables Product Managers, Technical Leads, QA Engineers, and Managers to orchestrate AI-driven software development. This specification defines the complete user experience for a platform where humans direct AI workers through the entire development lifecycle: ticket → AI code generation → automated QA → GitHub → deployment → production monitoring.

**Emotional Design Goal:** Calm/Focused + Innovative  
**Core Experience:** PM monitoring AI execution in real-time + TL validating architecture decisions  
**Platform:** Laptop-optimized (primary), Full mobile functionality (responsive)

---

## Project Vision & User Understanding

### **What We're Building**

An AI-augmented orchestration platform transforming a traditional 30-person software house into a lean 12-15 person operation managing 50+ projects through AI agents.

**The Transformation:**
- **From:** Developers writing code manually
- **To:** Elite orchestrators directing AI workers with perfect tickets

### **Target Users - The Orchestration Team**

#### **Product Managers (5-7 users)** - PRIMARY FOCUS
- **Role:** Elite ticket writers managing 10-15 AI projects simultaneously
- **Core Need:** Monitor AI execution progress, approve/reject code, manage workload
- **Pain Point:** Burnout from managing too many projects
- **Success Metric:** Can handle 10+ projects without feeling overwhelmed

#### **Technical Leads (3-4 users)** - SECONDARY FOCUS  
- **Role:** AI capability safety net, architecture validators
- **Core Need:** Review AI architecture decisions before implementation
- **Pain Point:** Can't review every single decision at scale
- **Success Metric:** Pattern-based review is efficient and catches critical issues

#### **Lead QA Engineers (2-3 users)**
- **Role:** Quality gatekeepers using statistical sampling
- **Core Need:** Review code samples, approve for production
- **Pain Point:** Can't manually test everything
- **Success Metric:** 20% sample inspection catches 95%+ of bugs

#### **Managers (1-2 users)**
- **Role:** Strategic oversight, client relationships, cost monitoring
- **Core Need:** Business metrics, GO/NO-GO decision data
- **Pain Point:** Need real-time visibility into transformation progress
- **Success Metric:** Data-driven decisions at phase gates

### **Core Experience - The Defining Interaction**

**"It's the dashboard where I watch AI build my entire project in real-time and approve it before it goes live"**

Two critical interactions define this platform:

1. **PM Monitoring AI Execution** (Primary)
   - Real-time progress updates as AI generates code
   - Clear visibility into what AI is doing right now
   - Confidence scores showing AI's certainty
   - Final approval gate before deployment

2. **TL Validating Architecture** (Secondary)
   - AI surfaces architecture decisions for human review
   - Pattern-based review queue (not every decision)
   - Approve/reject with rationale
   - Set constraints that AI must follow

---

## Inspiration & UX Pattern Analysis

### **Research Findings**

Analyzed modern AI orchestration dashboards, developer tools, and CI/CD pipeline interfaces. Key insights:

#### **What Makes Great Orchestration Dashboards**

**From AI Orchestration Platforms (2025 Trends):**
- ✅ **Real-time Progress Visualization:** Live updates showing exactly what AI is doing
- ✅ **Explainable AI Integration:** Clear explanations of AI decisions (builds trust)
- ✅ **Predictive Analytics:** Proactive alerts before issues escalate
- ✅ **Conversational Interfaces:** Natural language interactions for querying status
- ✅ **Unified Observability:** Logs, metrics, traces in single interface

**From Developer Tools (Jira, Azure DevOps, CircleCI):**
- ✅ **Customizable Views:** Role-specific dashboards (PM sees different data than TL)
- ✅ **Alert Systems:** Threshold detection with actionable notifications
- ✅ **Multi-Source Integration:** Aggregate data from GitHub, ClickUp, AI providers
- ✅ **Workflow Blocker Analysis:** Pinpoint delays in review, build, QA processes
- ✅ **DORA Metrics:** Lead time, deployment frequency, failure rate tracking

**From CI/CD Pipelines (GitLab, Jenkins, Octopus):**
- ✅ **Clear Approval Gates:** Visual markers showing "Waiting for Approval"
- ✅ **Approver Information:** Who can approve, approval history, comments
- ✅ **Actionable Controls:** Approve/Reject buttons with contextual details
- ✅ **Status Color Coding:** Green (success), Red (failure), Yellow (pending), Blue (in-progress)
- ✅ **Pipeline Flow Visualization:** Step-by-step progress with current stage highlighted

### **Key UX Patterns We'll Adopt**

1. **Real-Time Status Cards:** Each AI project is a card showing live progress
2. **Kanban-Style Workflow:** Tickets move through stages: Queue → AI Working → QA → Approval → Deployed
3. **Traffic Light System:** Color-coded status indicators for instant understanding
4. **Drill-Down Details:** Click any project for full execution details, logs, AI decisions
5. **Notification Center:** Centralized alerts for approvals needed, budget warnings, failures
6. **Responsive Timeline:** Horizontal timeline showing ticket → code → deploy journey
7. **Confidence Badges:** AI confidence scores (High/Medium/Low) with explanations
8. **Quick Actions:** One-click approve/reject/escalate from dashboard

---

## Design System Selection

### **Chosen Design System: shadcn/ui (Tailwind-based)**

**Rationale:**
- ✅ **Modern & Customizable:** Perfect for innovative feel, easy to theme
- ✅ **Accessible by Default:** WCAG 2.1 AA compliance built-in
- ✅ **Laptop-Optimized:** Clean, efficient use of screen space
- ✅ **Mobile-Responsive:** Components adapt beautifully to mobile
- ✅ **Developer-Friendly:** React + TypeScript (matches NestJS backend)
- ✅ **Calm Aesthetic:** Minimalist, not overwhelming

**Component Library Provides:**
- Buttons, Forms, Modals, Dropdowns, Tabs, Tables, Cards
- Data visualization-ready (integrates with Recharts)
- Real-time updates (works with Socket.IO)
- Toast notifications, Badge components
- Command palette (for power users)

**Custom Components Needed:**
1. **AI Execution Progress Tracker** - Real-time progress with stages
2. **Confidence Score Badge** - Visual indicator of AI certainty levels
3. **Approval Queue Card** - Compact review interface with approve/reject
4. **Cost Meter** - Real-time budget usage visualization
5. **Architecture Decision Card** - TL review interface with ADR context
6. **Project Portfolio Grid** - PM's bird's-eye view of all projects

---

## Visual Foundation

### **Color Theme: "Focused Innovation"**

**Emotional Pairing:**
- **Calm/Focused:** Cool tones, spacious layouts, subtle transitions
- **Innovative:** Modern accents, data visualizations, futuristic touches

**Color Palette:**

#### **Primary: Slate + Electric Blue**
- **Slate 900** (#0f172a) - Background, grounding
- **Slate 800** (#1e293b) - Cards, surfaces
- **Slate 700** (#334155) - Borders, dividers
- **Electric Blue** (#3b82f6) - Primary actions, links, focus states
- **Blue 600** (#2563eb) - Hover states

#### **Semantic Colors:**
- **Success:** Emerald 500 (#10b981) - AI success, deployments complete
- **Warning:** Amber 500 (#f59e0b) - Budget warnings, pending approvals
- **Error:** Red 500 (#ef4444) - AI failures, critical alerts
- **Info:** Sky 500 (#0ea5e9) - Informational states, notifications
- **Neutral:** Gray 400-600 - Text, secondary elements

#### **Specialty Colors:**
- **AI Working:** Violet 500 (#8b5cf6) - AI actively generating code
- **Awaiting Approval:** Yellow 500 (#eab308) - Human decision needed
- **Innovative Accent:** Cyan 400 (#22d3ee) - Cutting-edge features, tooltips

**Rationale:** Slate provides calm, professional foundation. Electric blue conveys innovation. Color-coded statuses enable instant visual parsing.

### **Typography System**

**Font Family:**
- **Headings:** Inter (Google Fonts) - Clean, modern, technical
- **Body:** Inter - Consistency, excellent readability at all sizes
- **Monospace:** JetBrains Mono - Code snippets, logs, technical details

**Type Scale:**
- **h1:** 36px / 2.25rem - Page titles
- **h2:** 30px / 1.875rem - Section headers
- **h3:** 24px / 1.5rem - Card titles
- **h4:** 20px / 1.25rem - Subsection headers
- **Body:** 16px / 1rem - Primary content
- **Small:** 14px / 0.875rem - Captions, metadata
- **Tiny:** 12px / 0.75rem - Timestamps, labels

**Font Weights:**
- **Bold (700):** Critical information, CTAs
- **Semibold (600):** Headers, emphasis
- **Medium (500):** Navigation, labels  
- **Regular (400):** Body text

### **Spacing & Layout**

**Base Unit:** 4px spacing system (4, 8, 12, 16, 24, 32, 48, 64)

**Layout Grid:**
- **Desktop:** 12-column grid, max-width 1440px (laptops)
- **Tablet:** 8-column grid, max-width 1024px
- **Mobile:** 4-column grid, full-width with 16px padding

**Container Widths:**
- **Wide:** 1440px - Dashboards, data-heavy views
- **Standard:** 1200px - Forms, detail pages
- **Narrow:** 768px - Modals, focused tasks

**Breakpoints:**
- **Mobile:** < 768px
- **Tablet:** 768px - 1024px
- **Laptop:** 1024px - 1440px
- **Desktop:** > 1440px (bonus space, not required)

---

## Core Experience Principles

Based on emotional goals and user needs:

### **1. Speed: Real-Time Responsiveness**
- AI execution updates every 2-3 seconds (live progress)
- Dashboard data refreshes via Socket.IO (no manual refresh)
- Actions (approve, reject, escalate) feel instant (< 500ms feedback)
- No loading spinners for cached data

**Why:** Fast feedback reduces anxiety, keeps users engaged, builds trust in the system

### **2. Guidance: Progressive Disclosure**
- Start with essential information, reveal details on demand
- Tooltips explain AI confidence scores ("Why is this Medium?")
- Empty states guide next actions ("Create your first ticket")
- Contextual help always available (? icons)

**Why:** Prevents overwhelming users with 50+ projects worth of data at once

### **3. Flexibility: Role-Optimized Views**
- PM Dashboard != TL Dashboard != QA Dashboard != Manager Dashboard
- Customizable project filters (by status, by client, by AI provider)
- Saved views ("My High-Priority Projects", "Awaiting My Approval")
- Dark mode / Light mode toggle

**Why:** Different roles need different information density and focus

### **4. Feedback: Calm but Celebratory**
- Success: Subtle green checkmark + brief toast (not jarring)
- Error: Clear error message + suggested fix (not alarming)
- Progress: Smooth animations, progress bars (not jumpy)
- Milestones: Confetti animation when project deploys (celebrate wins!)

**Why:** Calm feedback reduces stress, celebratory moments build team morale

---

---

## Design Direction Mockups

### **Approach 1: Card-Based Project Gallery (Primary PM View)**

![PM Dashboard - Card Layout](/Users/khakanali/.gemini/antigravity/brain/7fb54a93-f8d6-4bdb-b18d-82e1ec5e5c4b/pm_dashboard_primary_1764258237874.png)

**Philosophy:** "Scannable Project Portfolio"

**Key Characteristics:**
- **Layout:** 3-column grid of project cards, left sidebar navigation
- **Density:** Spacious (breathing room between cards)
- **Content Focus:** Visual status indicators, real-time progress bars
- **Best For:** PMs managing 10-15 projects who need at-a-glance status

**Strengths:**
- ✅ Extremely fast visual parsing (color-coded cards)
- ✅ Comfortable information density (not overwhelming)
- ✅ Quick actions always visible (Approve/View Details)
- ✅ Real-time progress bars show AI activity instantly

**Design Decisions:**
- **Card Size:** Large enough to show essential metrics without clicking
- **Progress Bar:** Prominent violet bar shows AI actively working
- **Status Badges:** Color-coded (green/yellow/blue/red) for instant recognition
- **Whitespace:** Generous padding creates calm, focused feeling

---

### **Approach 2: Kanban Workflow View (Alternate PM View)**

![PM Dashboard - Kanban Layout](/Users/khakanali/.gemini/antigravity/brain/7fb54a93-f8d6-4bdb-b18d-82e1ec5e5c4b/pm_dashboard_kanban_1764258263469.png)

**Philosophy:** "Workflow-Centric Orchestration"

**Key Characteristics:**
- **Layout:** Horizontal Kanban columns (Queue → AI Working → QA → Approval → Deployed)
- **Density:** Dense (more projects visible at once)
- **Content Focus:** Workflow stages and bottlenecks
- **Best For:** PMs who think in pipelines, want to spot workflow blockers

**Strengths:**
- ✅ Visualizes entire pipeline flow at once
- ✅ Easy to spot bottlenecks (column with most cards)
- ✅ Drag-and-drop feel (even if automated)
- ✅ Quick filters at top ("My Projects", "High Priority")

**Design Decisions:**
- **Column Highlight:** "AI Working" column glows subtly (most active stage)
- **Card Count:** Shows count per column (instant workload visibility)
- **Compact Cards:** Smaller cards fit more projects on screen
- **Confidence Badges:** Colored dots (High/Med/Low) for quick assessment

---

### **Approach 3: Technical Lead Architecture Review Queue**

![TL Architecture Review Interface](/Users/khakanali/.gemini/antigravity/brain/7fb54a93-f8d6-4bdb-b18d-82e1ec5e5c4b/tl_architecture_review_1764258284748.png)

**Philosophy:** "Context-Rich Decision Making"

**Key Characteristics:**
- **Layout:** Split-view (60% decision context, 40% action panel)
- **Density:** Information-rich (TLs need full context)
- **Content Focus:** Architecture Decision Record (ADR) with AI rationale
- **Best For:** TLs validating complex architecture decisions quickly

**Strengths:**
- ✅ All decision context in one view (no clicking around)
- ✅ Clear approve/reject actions with comment capability
- ✅ Risk indicators help prioritize reviews
- ✅ Related decisions timeline shows patterns

**Design Decisions:**
- **Split View:** Dedicated space for decision vs. action
- **Code Highlighting:** Syntax-highlighted code blocks for readability
- **Risk Badges:** Color-coded risk levels (High/Medium/Low)
- **Queue Status:** Persistent "12 pending" count maintains urgency

---

## Design Direction Recommendation

**Primary PM Dashboard:** **Card-Based Gallery (Approach 1)** with option to toggle to Kanban view

**Rationale:**
1. **Calm/Focused Emotional Goal:** Card layout provides breathing room, reduces cognitive overload
2. **Laptop Optimization:** 3-column grid perfectly utilizes 1440px width
3. **Real-Time Monitoring:** Progress bars and status badges enable instant status checks
4. **Scalability:** PMs managing 10-15 projects need scannable interface (not dense Kanban)
5. **Innovative Touch:** Modern card design feels cutting-edge while remaining professional

**Hybrid Approach:**
- Default to Card Gallery for most PMs
- Provide Kanban toggle for power users who prefer pipeline view
- Both views use same data, just different visualizations

---

---

## User Journey Flows

### **Journey 1: PM Monitors & Approves AI Execution (Primary Flow)**

**User Goal:** Ensure AI correctly implements a feature ticket and deploy it to production.
**Entry Point:** PM Dashboard (Project Card)

**Flow Steps:**

1.  **Dashboard Monitoring**
    *   **User sees:** Project card showing "AI Working - 65%". Progress bar animating.
    *   **User does:** Clicks "View Details" on the card.
    *   **System responds:** Opens Project Detail View (slide-over or full page).

2.  **Execution Detail View**
    *   **User sees:**
        *   Live terminal logs (streaming)
        *   Current step: "Generating unit tests..."
        *   Confidence Score: "High (92%)"
        *   File changes list (real-time updates)
    *   **User does:** Watches progress, checks generated files.

3.  **Completion & Review**
    *   **System responds:** AI finishes. Status changes to "Awaiting Approval". Notification toast appears.
    *   **User sees:** "Ready for Review" banner. Summary of changes. Automated QA results (Pass/Fail).
    *   **User does:** Reviews code diffs (optional), checks QA report.

4.  **Approval Decision**
    *   **User does:** Clicks "Approve for Deployment".
    *   **System responds:** Modal confirmation: "Deploy to Staging?".
    *   **User does:** Confirms.
    *   **System responds:** Status updates to "Deploying". Success toast.

**Decision Points:**
*   **QA Failure:** If automated QA fails, status goes to "QA Failed". User can "Retry with Instructions" or "Escalate to Human Dev".
*   **Low Confidence:** If AI confidence < 70%, system flags "Human Review Recommended".

---

### **Journey 2: TL Reviews Architecture Decision (Secondary Flow)**

**User Goal:** Validate AI's proposed architectural change before code is written.
**Entry Point:** Notification or "Approvals" tab.

**Flow Steps:**

1.  **Notification Receipt**
    *   **User sees:** Notification badge "3 Pending Architecture Reviews".
    *   **User does:** Clicks notification.

2.  **Review Queue**
    *   **User sees:** List of pending decisions sorted by Risk Score. High-risk items at top.
    *   **User does:** Selects top item: "New Database Schema for User Profiles".

3.  **Decision Analysis**
    *   **User sees:** Split view (Mockup Approach 3).
        *   Left: AI's proposed schema change, rationale, and impact analysis.
        *   Right: Review controls.
    *   **User does:** Reads rationale. Checks "Impact Analysis" to see affected modules.

4.  **Action**
    *   **User does:** Notices a missing index. Types comment: "Add index on email field for performance." Clicks "Request Changes".
    *   **System responds:** Item moves to "Returned to AI". AI gets feedback loop.

---

### **Journey 3: Lead QA Statistical Sampling**

**User Goal:** Spot-check random AI-generated code to ensure quality standards.
**Entry Point:** QA Dashboard.

**Flow Steps:**

1.  **Sampling Queue**
    *   **User sees:** "Daily Sample Queue (5 items)". System has randomly selected 20% of today's tickets.
    *   **User does:** Opens first item.

2.  **Code Inspection**
    *   **User sees:** Diff view of the feature. Test coverage report.
    *   **User does:** Scans code structure, checks edge case handling.

3.  **Verification**
    *   **User does:** Clicks "Run Tests" to verify locally (optional).
    *   **System responds:** Runs test suite in isolated container. Returns "All Green".

4.  **Sign-off**
    *   **User does:** Clicks "Mark Verified".
    *   **System responds:** Item removed from queue. Quality metrics updated.

---

## Component Library Strategy

### **Custom AI Components**

These components are specific to the AI Orchestration domain and extend the shadcn/ui base.

#### **1. AI Execution Progress Tracker**
*   **Purpose:** Visualize the "black box" of AI execution.
*   **Anatomy:**
    *   **Linear Progress Bar:** Multi-colored segments (Planning → Coding → Testing).
    *   **Pulse Animation:** Indicates active processing.
    *   **Step Label:** "Writing tests for auth.service.ts..."
    *   **Time Estimate:** "Est. 2m remaining".
*   **States:** Idle (gray), Working (violet pulse), Success (green solid), Error (red striped).

#### **2. Confidence Score Badge**
*   **Purpose:** Communicate AI certainty to help humans decide when to intervene.
*   **Anatomy:**
    *   **Pill Shape:** Rounded badge.
    *   **Icon:** Brain or Sparkle icon.
    *   **Text:** "High (95%)", "Med (72%)", "Low (45%)".
    *   **Tooltip:** Hover explains *why* (e.g., "Unfamiliar codebase pattern").
*   **Variants:**
    *   **High:** Green background, dark green text.
    *   **Medium:** Yellow background, dark yellow text.
    *   **Low:** Red background, dark red text.

#### **3. Architecture Decision Record (ADR) Card**
*   **Purpose:** Present complex technical decisions for quick review.
*   **Anatomy:**
    *   **Header:** Title + Risk Badge.
    *   **Code Block:** Syntax-highlighted snippet of the change.
    *   **Rationale:** Collapsible text section.
    *   **Impact Grid:** "Files: 3", "Complexity: +2", "Risk: High".
*   **Interactions:** Expand/Collapse details. Inline commenting.

#### **4. Cost Meter**
*   **Purpose:** Real-time visibility into AI compute spend.
*   **Anatomy:**
    *   **Radial or Linear Gauge:** Shows current spend vs. budget.
    *   **Text:** "$12.50 / $50.00".
    *   **Trend:** "↑ 15% vs last week".
*   **States:** Normal (blue), Warning (>80% budget, orange), Critical (>100%, red).

---

## UX Pattern Decisions

### **1. Navigation Patterns**
*   **Primary Nav:** Left Sidebar (Desktop) / Bottom Bar (Mobile).
    *   *Why:* Vertical space is precious on laptops; sidebar scales better for many projects.
*   **Breadcrumbs:** Always visible on detail pages.
    *   *Format:* Projects > [Project Name] > Ticket #123
*   **Back Button:** Browser back button works + dedicated "Back to Dashboard" link.

### **2. Feedback Patterns**
*   **Toast Notifications:** For non-blocking updates (e.g., "Deployment started").
    *   *Position:* Bottom-right.
    *   *Duration:* 5s auto-dismiss.
*   **Modal Dialogs:** For critical decisions only (e.g., "Reject Architecture", "Deploy to Prod").
    *   *Behavior:* Click outside to dismiss (unless destructive). Focus trap enabled.
*   **Inline Validation:** For form inputs (e.g., Ticket creation).
    *   *Timing:* On blur.

### **3. Empty State Patterns**
*   **First Use:** "Welcome to Dark Software Factory. Create your first project to start orchestrating." + CTA Button.
*   **No Results:** "No projects match 'fintech'. Clear filters?"
*   **Cleared Queue:** "All caught up! No pending approvals." + Illustration of relaxing robot.

### **4. Notification Patterns**
*   **Grouping:** Group by Project. "3 updates for Project Alpha".
*   **Priority:**
    *   **Critical (Red):** Failures, Budget Cap Hit. (Persistent, requires dismissal).
    *   **Action Required (Yellow):** Approvals needed. (Persistent).
    *   **Info (Blue):** Success, Status change. (Auto-dismiss).

---

## Responsive & Mobile Strategy

**Philosophy:** "Monitor anywhere, Orchestrate on desktop."

### **Breakpoint Strategy**
*   **Mobile (< 768px):** Single column.
    *   *Navigation:* Bottom tab bar (Dashboard, Alerts, Profile).
    *   *Dashboard:* Stacked cards. Simplified metrics.
    *   *Actions:* "Approve" is still available, but deep code review is hidden/warning shown ("Best viewed on desktop").
*   **Tablet (768px - 1024px):** Two column grid.
    *   *Navigation:* Collapsed sidebar (icons only).
*   **Desktop (> 1024px):** Three column grid. Full sidebar.

### **Mobile Adaptations**
*   **Data Tables:** Convert to "Card View" on mobile. No horizontal scrolling.
*   **Code Diffs:** Hidden by default on mobile. "View File" opens full screen modal.
*   **Touch Targets:** All buttons min 44px height.

---

## Accessibility Requirements (WCAG 2.1 AA)

### **1. Color Contrast**
*   **Text:** Minimum 4.5:1 contrast ratio against background.
*   **UI Components:** Minimum 3:1 for borders and icons.
*   *Note:* Electric Blue (#3b82f6) on Slate 900 passes AA.

### **2. Keyboard Navigation**
*   **Focus Indicators:** Visible ring (Electric Blue) around focused elements.
*   **Tab Order:** Logical flow (Top-down, Left-right).
*   **Shortcuts:**
    *   `Cmd+K`: Open Command Palette (Search projects, actions).
    *   `Esc`: Close modals.

### **3. Screen Reader Support**
*   **ARIA Labels:** All icon-only buttons (e.g., "Settings" icon) must have `aria-label`.
*   **Live Regions:** Progress bars use `aria-live="polite"` to announce updates without stealing focus.
*   **Status Changes:** Announced dynamically ("Status changed to Success").

---

## Final Deliverables Checklist

*   ✅ **UX Design Specification Document** (This file)
*   ✅ **Visual Design Mockups** (Embedded)
*   ✅ **Color & Typography System** (Defined)
*   ✅ **Component Specifications** (Defined)

**Status:** Specification Complete. Ready for Implementation.


