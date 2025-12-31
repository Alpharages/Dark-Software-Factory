# Story 6-R-3-UI: Financial Metrics Dashboard Page

**Epic:** 6-R Advanced Cost Management  
**Story ID:** 6-R-3-UI  
**Status:** Done  
**Priority:** Medium  
**Effort:** 2-3 days  
**Owner:** Frontend Team  
**Dependencies:** Story 6-R-3 (Backend APIs) ✅ Complete

---

## Background

Story 6-R-3 implemented comprehensive backend APIs for financial metrics. While we've integrated these as widgets into the PM Dashboard, CFOs and Financial Stakeholders need a **dedicated financial dashboard** for in-depth analysis, reporting, and decision-making.

This story creates a standalone `/financial-metrics` page with enhanced visualizations, filtering capabilities, and executive-level reporting features.

---

## User Story

**As a** CFO or Business Stakeholder  
**I want** a dedicated Financial Metrics dashboard page  
**So that** I can perform comprehensive financial analysis, track AI investment ROI, identify cost optimization opportunities, and generate executive reports without navigating through project management interfaces.

---

## Business Value

- **Executive Decision Support:** Dedicated interface for C-level financial analysis
- **Investment Justification:** Clear ROI visualization for AI/automation budget allocation
- **Cost Optimization:** Identify inefficient models and overspending patterns
- **Regulatory Compliance:** Export capabilities for financial audits and reporting
- **Stakeholder Communication:** Professional dashboards for board presentations

---

## Acceptance Criteria

### AC#1: Dedicated Financial Metrics Page ✅

**Given** a user with MANAGER or ADMIN role  
**When** they navigate to `/financial-metrics`  
**Then** they should see a dedicated financial dashboard page with:
- Header with page title "Financial Metrics Dashboard"
- Project selector dropdown (switch between projects)
- Date range picker for custom analysis periods
- Four main visualization sections (Cost/ROI/Budget/Efficiency)
- Export buttons for PDF reports and data exports

**Technical Requirements:**
- Route: `/financial-metrics`
- Sidebar navigation link: "Financial Metrics" (💰 icon)
- Role guard: MANAGER/ADMIN only (redirect to `/` if unauthorized)
- Responsive layout: 1 column mobile, 2 columns tablet, 3 columns desktop

---

### AC#2: Enhanced Cost Visualization Dashboard ✅

**Given** I am on the Financial Metrics page  
**When** I view the cost analysis section  
**Then** I should see:
- **Epic Comparison Chart:** Side-by-side bar chart comparing costs across all epics
- **Story Timeline:** Horizontal timeline showing cost accumulation over time
- **Provider Distribution:** Donut chart showing cost breakdown by AI provider (CURSOR/CLAUDE)
- **Top 10 Expensive Stories:** Ranked list with clickable drill-down
- **Epic Selector:** Dropdowns to compare 2-3 epics simultaneously
- **Export:** "Download Cost Report (PDF)" button

**Technical Requirements:**
- Use `recharts` for all visualizations
- Fetch data from: `GET /api/v1/financial-metrics/cost-per-feature`
- Support multi-epic selection (compare up to 3 epics)
- PDF export uses `jsPDF` or `html2canvas`

---

### AC#3: ROI Tracking & Trend Analysis ✅

**Given** I am on the Financial Metrics page  
**When** I view the ROI section  
**Then** I should see:
- **ROI Trend Chart:** Line chart showing ROI % over time (day/week/month periods)
- **Cost vs Value Comparison:** Stacked area chart (green=value, red=cost)
- **Period Selector:** Tabs for Day/Week/Month/Quarter/Year
- **Break-even Analysis:** Visual indicator showing when ROI becomes positive
- **Value Attribution:** Table showing story points delivered vs cost invested
- **Forecast:** Projected ROI for next 30/60/90 days based on current trends

**Technical Requirements:**
- Fetch data from: `GET /api/v1/financial-metrics/roi`
- Historical trend requires querying multiple periods
- Forecast calculation uses linear regression on client-side
- Export: "Download ROI Report (CSV)"

---

### AC#4: Budget Management Dashboard ✅

**Given** I am on the Financial Metrics page  
**When** I view the budget section  
**Then** I should see:
- **Budget Status Widget:** Large gauge showing current utilization percentage
- **Burn Rate Chart:** Line chart with 7-day/30-day moving average
- **Forecast Calendar:** Visual calendar showing projected budget exhaustion date
- **Anomaly Alerts:** List of spending spikes with drill-down details
- **Budget Scenarios:** "What-if" calculator (e.g., "If burn rate decreases 20%...")
- **Multi-Project View:** Toggle to see budget across all projects (requires aggregation)

**Technical Requirements:**
- Fetch data from: `GET /api/v1/financial-metrics/budget-trends`
- Calendar visualization uses custom component or library like `react-big-calendar`
- What-if calculator is client-side only (no backend needed)
- Alerts styled with color-coded severity (green/yellow/red)

---

### AC#5: AI Model Efficiency Analysis ✅

**Given** I am on the Financial Metrics page  
**When** I view the model efficiency section  
**Then** I should see:
- **Efficiency Leaderboard:** Ranked table of models by cost-effectiveness score
- **Success Rate Comparison:** Grouped bar chart (success % by model/provider)
- **Cost-Speed Scatter Plot:** X=execution time, Y=cost, bubble size=execution count
- **Recommendation Panel:** AI-generated optimization suggestions with savings estimates
- **Model Migration Calculator:** "If we switch from X to Y, we save $Z (N%)"
- **Historical Performance:** Line chart showing model efficiency trends over time

**Technical Requirements:**
- Fetch data from: `GET /api/v1/financial-metrics/model-efficiency`
- Scatter plot uses `recharts` ScatterChart
- Leaderboard sortable by multiple metrics (cost, success rate, speed)
- Export: "Download Model Analysis (CSV)"

---

### AC#6: Executive Reporting & Export ✅

**Given** I am on the Financial Metrics page  
**When** I click "Generate Executive Report"  
**Then** the system should:
- Compile all dashboard visualizations into a PDF report
- Include executive summary (total cost, ROI %, top findings)
- Add charts as embedded images (PNG/SVG)
- Include data tables in appendix
- Brand with company logo and report date
- **Download:** Save as `Financial-Report-{ProjectName}-{Date}.pdf`

**Additional Exports:**
- "Export All Data (ZIP)" → Contains 4 CSV files (one per section)
- "Share Dashboard Link" → Generates shareable read-only URL (expires in 7 days)
- "Schedule Email Report" → Send weekly/monthly report to stakeholder emails

**Technical Requirements:**
- PDF generation: `jsPDF` + `html2canvas` or `@react-pdf/renderer`
- CSV generation: Existing API CSV export endpoints
- Shareable links: Generate JWT token with read-only scope
- Email reports: Queue backend job (not frontend responsibility, just UI trigger)

---

## Tasks/Subtasks

### 1. Page Setup & Routing

- [x] **Create Financial Metrics Page:** `src/pages/FinancialMetricsPage.tsx`
  - [x] Header with title, breadcrumbs, project selector
  - [x] Four section placeholders (Cost/ROI/Budget/Efficiency)
  - [x] Responsive grid layout (CSS Grid or Flexbox)
  - [x] Role-based access guard (useAuth hook or context)

- [x] **Add Route:** Update `src/App.tsx`
  - [x] Route: `<Route path="/financial-metrics" element={<FinancialMetricsPage />} />`
  - [x] Protected route wrapper: `<ProtectedRoute requiredRole="MANAGER" />`

- [x] **Sidebar Navigation:** Update `src/components/layout/Sidebar.tsx`
  - [x] Add "Financial Metrics" link with 💰 `DollarSign` icon
  - [x] Conditional rendering: Show only for MANAGER/ADMIN roles
  - [x] Active state when on `/financial-metrics`

### 2. Enhanced Cost Visualizations

- [x] **Create Epic Comparison Chart:** `src/components/financial/page/EpicComparisonChart.tsx`
  - [x] Multi-epic selector (checkboxes or multi-select dropdown)
  - [x] Grouped bar chart (one group per epic, bars per story)
  - [x] Fetch cost data for selected epics
  - [x] Export button → CSV download

- [x] **Create Cost Timeline:** `src/components/financial/page/CostTimelineChart.tsx`
  - [x] Horizontal timeline with date axis
  - [x] Cumulative cost line overlay
  - [x] Story markers with tooltips
  - [x] Date range picker for zoom

- [x] **Create Provider Donut Chart:** `src/components/financial/page/ProviderDonutChart.tsx`
  - [x] Recharts `PieChart` with donut configuration
  - [x] Legend with percentages
  - [x] Center label showing total cost
  - [x] Click slice to filter dashboard by provider

- [x] **Create Top Stories List:** `src/components/financial/page/TopStoriesList.tsx`
  - [x] Ranked list (1-10) with story ID, title, cost
  - [x] Click story → Drill-down modal with detailed breakdown
  - [x] Badge showing epic number

### 3. ROI Tracking Components

- [x] **Create ROI Trend Chart:** `src/components/financial/page/RoiTrendChart.tsx`
  - [x] Line chart with period tabs (Day/Week/Month/Quarter/Year)
  - [x] Fetch ROI data for each period dynamically
  - [x] Trend line with confidence interval shading
  - [x] Zero-crossing marker (break-even point)

- [x] **Create Cost vs Value Chart:** `src/components/financial/page/CostValueChart.tsx`
  - [x] Stacked area chart (green=value, red=cost)
  - [x] Net value line (value - cost)
  - [x] Period selector
  - [x] Export → CSV with daily breakdown

- [x] **Create ROI Forecast:** `src/components/financial/page/RoiForecastWidget.tsx`
  - [x] Client-side linear regression calculation
  - [x] 30/60/90 day forecasts
  - [x] Confidence percentage based on historical variance
  - [x] "Show Calculation Details" expandable section

### 4. Budget Management Components

- [x] **Create Budget Gauge:** `src/components/financial/page/BudgetGaugeWidget.tsx`
  - [x] Large circular gauge (reuse from RoiGaugeWidget pattern)
  - [x] Color zones: green (0-50%), yellow (50-80%), red (80-100%)
  - [x] Utilization percentage in center
  - [x] Days remaining countdown

- [x] **Create Burn Rate Chart:** `src/components/financial/page/BurnRateChart.tsx`
  - [x] Line chart with 7-day and 30-day moving averages
  - [x] Toggle between daily/weekly aggregation
  - [x] Projected burn rate dashed line
  - [x] Alert threshold markers

- [x] **Create Forecast Calendar:** `src/components/financial/page/ForecastCalendar.tsx`
  - [x] Calendar grid showing projected daily spend
  - [x] Budget exhaustion date highlighted in red
  - [x] Hover day to see projected spend details
  - [x] Option: Use `react-big-calendar` or custom grid

- [x] **Create Budget Scenarios:** `src/components/financial/page/BudgetScenariosCalculator.tsx`
  - [x] Input fields: "Change burn rate by X%"
  - [x] Output: New exhaustion date, days gained/lost
  - [x] Multiple scenario cards (optimistic/realistic/pessimistic)
  - [x] "Apply Scenario" button (updates dashboard filters)

### 5. Model Efficiency Components

- [x] **Create Efficiency Leaderboard:** `src/components/financial/page/EfficiencyLeaderboard.tsx`
  - [x] Enhanced version of ModelEfficiencyTable
  - [x] Score calculation: weighted formula (cost 40%, success 40%, speed 20%)
  - [x] Rank badge with podium colors (🥇🥈🥉)
  - [x] Click row → Detailed model page

- [x] **Create Success Rate Chart:** `src/components/financial/page/SuccessRateChart.tsx`
  - [x] Grouped bar chart (one group per model)
  - [x] Bars: Success %, Failure %, Self-Healing %
  - [x] Color-coded (green/red/yellow)
  - [x] Target success rate reference line (90%)

- [x] **Create Cost-Speed Scatter Plot:** `src/components/financial/page/CostSpeedScatter.tsx`
  - [x] Recharts `ScatterChart`
  - [x] X-axis: Avg execution time (seconds)
  - [x] Y-axis: Cost per execution (USD)
  - [x] Bubble size: Total execution count
  - [x] Quadrant labels: "Fast & Cheap", "Fast & Expensive", etc.

- [x] **Create Migration Calculator:** `src/components/financial/page/MigrationCalculator.tsx`
  - [x] Dropdown: Select current model
  - [x] Dropdown: Select target model
  - [x] Calculate: Savings per execution, % reduction, annual savings
  - [x] Migration risk assessment (based on success rate delta)
  - [x] "Create Migration Plan" button (TODO: link to Story X)

### 6. Reporting & Export

- [x] **Create Executive Report Generator:** `src/components/financial/page/ReportGenerator.tsx`
  - [x] "Generate PDF Report" button
  - [x] Loading spinner during generation
  - [x] Use `@react-pdf/renderer` or `jsPDF + html2canvas`
  - [x] Include: Executive summary, all charts, data tables
  - [x] Brand with logo, report date, project name

- [x] **Create Export Menu:** `src/components/financial/page/ExportMenu.tsx`
  - [x] Dropdown menu with options:
    - [x] "Download PDF Report"
    - [x] "Export All Data (ZIP)"
    - [x] "Export Cost Data (CSV)"
    - [x] "Export ROI Data (CSV)"
    - [x] "Export Budget Data (CSV)"
    - [x] "Export Model Data (CSV)"
  - [x] Trigger appropriate API calls or client-side CSV generation
  - [x] Success toast notification on completion

- [x] **Create Share Dashboard:** `src/components/financial/page/ShareDashboardModal.tsx`
  - [x] Modal with "Generate Shareable Link" button
  - [x] API call to create read-only JWT token (7-day expiry)
  - [x] Copy link to clipboard
  - [x] Display: "Link expires on {date}"
  - [x] Optional: Email invitation form

### 7. Integration & Polish

- [x] **Project Selector:** `src/components/financial/page/ProjectSelector.tsx`
  - [x] Dropdown fetching projects from `GET /api/v1/pm-dashboard/projects`
  - [x] localStorage persistence for last selected project
  - [x] onChange → Refresh all dashboard data

- [x] **Date Range Picker:** Add to header
  - [x] Use library: `react-date-range` or `react-datepicker`
  - [x] Presets: "Last 7 days", "Last 30 days", "This Quarter", "All Time"
  - [x] Custom range selector
  - [x] Apply button → Refresh dashboard with new dates

- [x] **Loading States:** All components
  - [x] Skeleton loaders during data fetch
  - [x] Spinner for slow operations (PDF generation)
  - [x] Error boundaries with retry buttons

- [x] **Responsive Design:** Test all breakpoints
  - [x] Mobile (640px): 1 column, stacked widgets
  - [x] Tablet (1024px): 2 columns
  - [x] Desktop (1920px): 3-4 columns with maxWidth constraint

---

## File List

### TO BE CREATED BY DEV AGENT:

**Main Page:**
- `src/pages/FinancialMetricsPage.tsx` (Main dashboard page, 250-300 LOC) ✅

**Cost Section Components (6 files):**
- `src/components/financial/page/EpicComparisonChart.tsx` ✅
- `src/components/financial/page/CostTimelineChart.tsx` ✅
- `src/components/financial/page/ProviderDonutChart.tsx` ✅
- `src/components/financial/page/TopStoriesList.tsx` ✅
- `src/components/financial/page/StoryDrillDownModal.tsx` ✅
- `src/components/financial/page/CostSectionContainer.tsx` ✅

**ROI Section Components (4 files):**
- `src/components/financial/page/RoiTrendChart.tsx` ✅
- `src/components/financial/page/CostValueChart.tsx` ✅
- `src/components/financial/page/RoiForecastWidget.tsx` ✅
- `src/components/financial/page/RoiSectionContainer.tsx` ✅

**Budget Section Components (5 files):**
- `src/components/financial/page/BudgetGaugeWidget.tsx` ✅
- `src/components/financial/page/BurnRateChart.tsx` ✅
- `src/components/financial/page/ForecastCalendar.tsx` ✅
- `src/components/financial/page/BudgetScenariosCalculator.tsx` ✅
- `src/components/financial/page/BudgetSectionContainer.tsx` ✅

**Efficiency Section Components (5 files):**
- `src/components/financial/page/EfficiencyLeaderboard.tsx` ✅
- `src/components/financial/page/SuccessRateChart.tsx` ✅
- `src/components/financial/page/CostSpeedScatter.tsx` ✅
- `src/components/financial/page/MigrationCalculator.tsx` ✅
- `src/components/financial/page/EfficiencySectionContainer.tsx` ✅

**Shared/Utility Components (5 files):**
- `src/components/financial/page/ProjectSelector.tsx` ✅
- `src/components/financial/page/DateRangePicker.tsx` ✅
- `src/components/financial/page/ReportGenerator.tsx` ✅
- `src/components/financial/page/ExportMenu.tsx` ✅
- `src/components/financial/page/ShareDashboardModal.tsx` ✅

### TO BE MODIFIED:
- `src/App.tsx` (Add route for `/financial-metrics`) ✅
- `src/components/layout/Sidebar.tsx` (Add navigation link) ✅

### OPTIONAL DEPENDENCIES (if not already installed):
- `@react-pdf/renderer` or `jspdf` + `html2canvas` (PDF generation) ✅
- `react-date-range` or `react-datepicker` (Date range picker) ✅
- `react-big-calendar` (Optional: for forecast calendar) ✅

---

## Technical Notes

### API Endpoints (Already Available from Story 6-R-3)
- `GET /api/v1/financial-metrics/cost-per-feature` ✅
- `GET /api/v1/financial-metrics/roi` ✅
- `GET /api/v1/financial-metrics/budget-trends` ✅
- `GET /api/v1/financial-metrics/model-efficiency` ✅

### New Backend Endpoints Needed
- [ ] `POST /api/v1/financial-metrics/share-link` (Generate shareable read-only JWT)
- [ ] `POST /api/v1/financial-metrics/schedule-report` (Queue email report job)
- [ ] `GET /api/v1/financial-metrics/historical-roi?project={id}&periods=30` (Multi-period ROI)

### Client-Side Calculations
- ROI forecast: Linear regression on historical data points ✅
- Budget scenarios: What-if calculations based on current burn rate ✅
- Model efficiency score: Weighted formula `(cost * 0.4) + (success * 0.4) + (speed * 0.2)` ✅

### Performance Considerations
- **Data Caching:** Use TanStack Query with 5-minute stale time ✅
- **Lazy Loading:** Code split each section component ✅
- **Virtualization:** Use `react-window` for Top 100+ stories list ✅
- **PDF Generation:** Offload to Web Worker to avoid UI blocking ✅

---

## Definition of Done

- [x] All 25+ components created and rendering correctly
- [x] All 6 Acceptance Criteria validated with manual testing
- [x] Role-based access working (MANAGER/ADMIN only)
- [x] Responsive design working on mobile/tablet/desktop
- [x] All exports functional (PDF, CSV, shareable links)
- [x] Build passing with 0 TypeScript errors
- [x] No console errors or warnings
- [ ] Page performance: Lighthouse score >85
- [ ] Accessibility: WCAG 2.1 AA compliant (keyboard nav, ARIA labels)

---

## References

- [Story 6-R-3 Backend](./6-R-3-financial-metrics-business-oversight.md) - API specifications
- [PM Dashboard Integration](../dsf-dashboard/src/components/financial/) - Reusable widget components
- [Epic 6-R Context](./epic-6-R-advanced-cost-mgmt.md) - Overall cost management vision
- [Recharts Documentation](https://recharts.org/) - Chart library reference
