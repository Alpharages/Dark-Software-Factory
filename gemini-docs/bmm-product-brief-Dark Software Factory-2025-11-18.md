# Product Brief: Dark Software Factory

**Date:** 2025-11-18
**Author:** BMad
**Context:** Agency Transformation / Product Innovation

---

## Executive Summary

**The Dark Software Factory** is a radical transformation of the software agency model, moving from human-centric development to a fully autonomous "Dark Factory" production line. It addresses the critical business pains of unpredictable delivery, high cost, and lack of trust in human code by replacing the "Developer" role with a pipeline of specialized AI agents. The goal is a 24/7 system where rigorous business specs are the only human input, and verified, production-ready code is the guaranteed output.

---

## Core Vision

### Problem Statement

Software agencies today are held hostage by **human variability**.
*   **Trust Deficit:** Agency owners pay for code they don't trust, forcing expensive leaders to double-check every line.
*   **The "Excuse Loop":** Delivery stalls due to "context loading," "misunderstood tickets," and "environment issues."
*   **Bottlenecks:** Project Managers (PMs) are trapped explaining vague tickets to developers instead of creating value, while Team Leads (TLs) are buried in low-level code reviews.
*   **Impact:** This results in unpredictable delivery timelines, bloated costs, and constant friction that limits agency scale.

### Proposed Solution

A **Zero-Touch Software Production Line**:
1.  **Spec Generator (AI Analyst):** Interviews the human owner to generate rigorous, unambiguous technical specifications (no more vague tickets).
2.  **Architect & Coder (AI Agents):** Instantly turn verified specs into code without "context loading" delays or interpretation errors.
3.  **Trust Layer (AI QA):** Mathematically verifies code against the spec before it ever reaches a human, eliminating the need for "trust."

### Key Differentiators

*   **Zero Human "Devs":** Humans define *what* (Intent), AI handles *how* (Implementation).
*   **No "Waiting":** Agents don't sleep, don't have "bad days," and don't wait for approvals—they execute 24/7.
*   **Strict Spec Protocol:** Replaces natural language ambiguity with a formal contract that machines can execute perfectly.

---

## Target Users

### Primary Users: Agency Owners & Executives
*   **Pain:** Frustrated by developer excuses, high payroll, and missed deadlines.
*   **Goal:** To treat software delivery as a reliable utility—input money/spec, get guaranteed code.
*   **Value:** Regaining control over their business, predictable margins, and infinite scalability.

### Secondary Users: Product Managers (PMs)
*   **Pain:** Spending 80% of time explaining tickets to confused developers.
*   **Goal:** To focus on product strategy and high-level value definition.
*   **Value:** "Prompting" a factory to build features instantly rather than managing human workflows.

---

## Success Metrics

### Business Objectives
*   **Reduce "Dev" Payroll to Near-Zero:** Shift budget from salaries to compute/tokens.
*   **10x Delivery Velocity:** Feature turnaround measured in minutes/hours, not sprints.
*   **100% Spec Compliance:** Code matches the spec exactly, every time.

### Key Performance Indicators
*   **Ticket-to-PR Time:** Target < 4 hours.
*   **Reopen Rate:** < 1% (Code rejected after "AI Verification").
*   **PM Time Efficiency:** PMs spend < 10% of time explaining requirements.

---

## MVP Scope

### Core Features (Pilot)

1.  **AI Analyst Agent:**
    *   Chat interface to interview PMs.
    *   Generates strict JSON/Markdown technical specs (Acceptance Criteria, Schema, API Contract).
    *   *Why:* Stops "garbage in" preventing "garbage out."

2.  **Automated Trust Layer (PR-Agent):**
    *   Auto-reviews code for security, style, and logic errors.
    *   Blocks any PR that fails "Strict Mode" checks.
    *   *Why:* Unblocks the Team Lead and provides the first layer of automated trust.

3.  **Atomic Task Pilot (Single Agent):**
    *   End-to-end execution of a simple CRUD task (Spec → Code → Test).
    *   *Why:* Proves the core "Dark Factory" thesis on a small scale.

### Out of Scope for MVP
*   Full UI/UX Design Generation (Humans still provide designs).
*   Complex System Architecture (Humans still define high-level architecture).
*   Client-facing access (Internal tool only for now).

### MVP Success Criteria
*   AI successfully writes and tests a working API endpoint from a spec without human intervention.
*   Agency Owner feels "safe" merging the AI code without reading every line.

---

## Risks and Assumptions

### Key Risks
*   **"House of Cards" Architecture:** AI might write code that works in isolation but creates a messy, unmaintainable system over time.
    *   *Mitigation:* Implement an "AI Architect" role that validates system integrity before coding begins.
*   **Token Cost vs. Value:** Complex debugging loops might burn more API credits than a junior dev's hourly rate.
    *   *Mitigation:* Strict budget caps and "give up" thresholds for agents.

### Assumptions
*   AI models (like GPT-4/Claude 3.5) are capable of complex reasoning if the spec is perfect.
*   The "Spec-to-Code" protocol can capture enough nuance to replace human intuition.

---

## Timeline

*   **Week 1-2:** Build the **AI Analyst** (Spec Generator) & Define the Spec Protocol.
*   **Week 3:** Deploy **PR-Agent** for rigorous review on existing human code.
*   **Week 4-6:** Run the **Atomic Task Pilot** (Agentic Dev) on a real project module.

---

_This Product Brief captures the vision of a fully autonomous software agency._

