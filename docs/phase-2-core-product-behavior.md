# RoboRebut — Phase 2.1 Core Product Behavior

## Objective
RoboRebut is not a generic chatbot.
It is a real-time objection handling engine that converts resistance into structured response strategy.

## Canonical Pipeline
INPUT → CLASSIFY → STRATEGIZE → GENERATE → EVALUATE → STORE

## Stage Definitions

### 1. INPUT
Purpose:
- Accept a live objection or resistance statement from the user
- Normalize the text into a clean internal payload

Input example:
- "This sounds too expensive"
- "I need to think about it"
- "Send me something first"

Output:
- normalized text
- metadata signals

### 2. CLASSIFY
Purpose:
- Identify what kind of objection the message represents

Initial objection types:
- price
- trust
- timing
- authority
- confusion
- brush_off
- hidden

Output:
- objection type
- confidence score
- reason signals

### 3. STRATEGIZE
Purpose:
- Decide the correct response method before generating language

Initial strategy approaches:
- reframe
- clarify
- question
- validate_then_shift
- challenge

Output:
- selected approach
- selected tone
- response structure steps

### 4. GENERATE
Purpose:
- Produce the actual rebuttal or reply

Output:
- primary reply
- optional follow-up questions

### 5. EVALUATE
Purpose:
- Score the generated response before final acceptance

Evaluation criteria:
- relevance
- tone match
- strategy alignment

Output:
- total score
- per-criteria scores
- retry decision

### 6. STORE
Purpose:
- Save the full interaction for learning, analytics, and future tuning

Stored data:
- input
- classification
- strategy
- generated output
- evaluation score
- timestamp

## Non-Negotiable Rule
Every real response in RoboRebut must eventually follow this flow:

INPUT → CLASSIFY → STRATEGIZE → GENERATE → EVALUATE → STORE

## Not in Scope for Phase 2.1
- advanced model tuning
- dashboard analytics
- memory systems
- multi-turn coaching logic
- CRM integrations

## Done Condition for Phase 2.1
Phase 2.1 is complete when:
1. the product behavior is written down clearly
2. the pipeline stages are defined
3. the TypeScript shapes for each stage are added to the backend
4. the project has a single source of truth for the pipeline