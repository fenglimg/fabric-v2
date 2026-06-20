# Design Research: Fabric v2 交互与策略优化

## 1. Reference Projects / Implementations

### 1.1 Claude Code Hooks System
**Source**: https://code.claude.com/docs/en/hooks.md

**Key Architecture Decisions**:
- **Deterministic execution**: Hooks run automatically at lifecycle points, not relying on LLM choice
- **Three cadences**: Session-level (SessionStart/End), Turn-level (UserPromptSubmit/Stop), Tool-level (PreToolUse/PostToolUse)
- **Non-blocking by default**: Hooks are advisory, execution proceeds even on non-zero exit
- **Trust model**: Non-managed hooks require explicit user trust before execution

**What Worked**:
- Parallel execution of matching hooks with automatic deduplication
- Multiple hook types: command, HTTP, prompt, agent
- `/hooks` browser for visibility and debugging
- Managed hooks for team enforcement

**Applicability to Fabric**:
- Hook lifecycle design is mature and well-documented
- Trust model addresses security concerns
- Visibility through `/hooks` command reduces cognitive load

### 1.2 Agentic Design Patterns
**Source**: https://agentic-design.ai/patterns/ui-ux-patterns

**Key Patterns**:
- **Progressive Disclosure**: summary → detailed → technical with visual hierarchy
- **Responsive Salience**: auto-adjust visibility based on task complexity, user expertise, risk
- **Epistemic UI**: visualize AI confidence, flag weak provenance, color-code uncertainty
- **Intentional Friction**: choreograph friction for high-stakes decisions

**What Worked**:
- State management for disclosure preferences
- "Expand all" escape hatch for power users
- Confidence visualization directs human cognitive effort

**Applicability to Fabric**:
- Cite policy could use progressive disclosure (summary first, contract on demand)
- Self-archive trigger could use responsive salience (more gates for new users)
- Multi-store complexity could use epistemic UI (show which store is active)

### 1.3 Interaction-Native Knowledge Harness (InKH)
**Source**: https://arxiv.org/html/2606.01886

**Core Philosophy**: "Adoption happens when complexity is absorbed by the system rather than transferred to the user"

**Architecture Components**:
1. Event-stream view of user, tool, and knowledge updates
2. Bounded working context buffer assembled by **passive injection** (not agent-driven search)
3. Temporal knowledge graph as low-latency retrieval substrate
4. Wiki audit surface for human-readable governance
5. Background extraction, maturity, decay, write-time invalidation

**What Worked**:
- Passive injection eliminates agent memory search burden
- Temporal graph handles evolving knowledge
- Wiki surface provides transparency without overwhelming

**Applicability to Fabric**:
- Current recall-based injection is similar to passive injection
- Missing: temporal graph, decay, write-time invalidation
- Wiki audit surface could replace verbose hook output

## 2. Extractable Patterns

### 2.1 Pattern: Passive Context Injection
**Description**: Inject relevant context automatically before agent action, without requiring agent to search or request.

**Implementation**:
- Event stream triggers context assembly
- Bounded buffer prevents overload
- Injection happens before main agent step

**Fabric Application**:
- PreToolUse hook already does this for recall
- Gap: No bounded buffer, no decay, no temporal awareness

### 2.2 Pattern: Responsive Salience
**Description**: Auto-adjust UI intensity based on context signals (task complexity, user expertise, risk).

**Implementation**:
- Monitoring agent evaluates signals continuously
- Low trust → increase salience (more gates, richer explanations)
- High trust → decrease salience (hands-off)
- User can override

**Fabric Application**:
- Self-archive could use this: new user → always ask, experienced user → auto-trigger
- Cite policy: high-stakes edit → require explicit cite, low-stakes → passive recall

### 2.3 Pattern: Intentional Friction
**Description**: For high-stakes irreversible actions, friction is safety, not design failure.

**Implementation**:
- Map task inventory by stakes
- Apply friction surgically, not blanket
- Visualize AI confidence to direct user attention

**Fabric Application**:
- Archive workflow: currently too much friction for low-value knowledge
- Multi-store write: needs friction for cross-store contamination risk

### 2.4 Pattern: Progressive Disclosure
**Description**: Gradually reveal complexity layers: summary → detailed → technical.

**Implementation**:
- Start with one-line summary
- Expand on explicit user action
- Remember preferences

**Fabric Application**:
- Cite policy: show "KB applied: K-001" only, contract on hover/expand
- Hook output: summary line only, full log in `.workflow/`

## 3. Architecture Approaches

### 3.1 Approach A: Hook-Driven Passive Injection (Current Fabric)
**Description**: PreToolUse hook runs `fab_recall`, injects descriptions into context.

**Pros**:
- Deterministic, always runs
- No agent memory burden

**Cons**:
- No bounded buffer (unbounded injection)
- No temporal awareness (stale knowledge persists)
- No decay (old knowledge never fades)
- High cognitive load (all descriptions shown)

**Trade-offs**: Simplicity vs. sophistication

### 3.2 Approach B: Temporal Knowledge Graph + Passive Injection
**Description**: Add temporal graph layer on top of current recall.

**Pros**:
- Handles evolving knowledge
- Write-time invalidation
- Decay removes stale entries

**Cons**:
- Significant implementation complexity
- New dependency (graph database or in-memory structure)
- Migration effort

**Trade-offs**: Sophistication vs. implementation cost

### 3.3 Approach C: Responsive Salience Engine
**Description**: Add salience monitor that adjusts interaction intensity.

**Pros**:
- Adapts to user expertise
- Reduces friction for experienced users
- Increases safety for beginners

**Cons**:
- Requires user modeling (expertise tracking)
- More moving parts
- Risk of wrong salience level

**Trade-offs**: Adaptability vs. complexity

### 3.4 Approach D: Wiki Audit Surface
**Description**: Replace verbose hook output with wiki-style audit log.

**Pros**:
- Human-readable governance
- Reduces terminal noise
- Searchable history

**Cons**:
- New artifact to manage
- Requires wiki infrastructure
- May hide important signals

**Trade-offs**: Visibility vs. noise reduction

## 4. UX/UI Patterns

### 4.1 Pattern: Confidence Visualization
**Description**: Show AI confidence levels to direct user cognitive effort.

**Fabric Application**:
- Recall results: show match score (0-1)
- Self-archive trigger: show confidence (high → auto, low → ask)
- Multi-store: show store confidence (which store has best match)

### 4.2 Pattern: Epistemic UI
**Description**: Highlight probabilistic leaps, flag weak provenance.

**Fabric Application**:
- Cite policy: show provenance chain (K-001 → source session → evidence)
- Archive: show extraction confidence
- Multi-store: show store origin for each knowledge piece

### 4.3 Pattern: Mixed-Initiative Controls
**Description**: Allow user to take control when needed, otherwise autonomous.

**Fabric Application**:
- Self-archive: auto-trigger but allow "撤销" to reject
- Cite: auto-recall but allow manual override
- Multi-store: auto-route but allow explicit store selection

## 5. Common Design Pitfalls

### 5.1 Pitfall: Over-Engineering Friction
**Anti-Pattern**: Apply friction uniformly to all operations.

**Consequence**: Users develop "click-through fatigue" and ignore all gates.

**Fabric Instance**: Cite policy requires explicit `[applied]` even for obvious recalls.

**Avoidance**: Use responsive salience — friction only for high-stakes.

### 5.2 Pitfall: Hiding Complexity in Logs
**Anti-Pattern**: Dump all information to logs, expect users to read.

**Consequence**: Users never read logs, miss important signals.

**Fabric Instance**: Hook output verbose, users ignore.

**Avoidance**: Progressive disclosure + wiki audit surface.

### 5.3 Pitfall: Forcing User to Coordinate System State
**Anti-Pattern**: User must manually track which store, which KB, which phase.

**Consequence**: Cognitive overload, errors.

**Fabric Instance**: Multi-store requires user to know active store.

**Avoidance**: Passive injection + epistemic UI (show current state).

### 5.4 Pitfall: Non-Deterministic Agent Behavior
**Anti-Pattern**: Rely on agent to "choose" to run critical operations.

**Consequence**: Operations skipped, inconsistent behavior.

**Fabric Instance**: Self-archive relies on agent to detect trigger signals.

**Avoidance**: Hooks for deterministic execution (already partially done).

## 6. Anti-Patterns to Avoid

### 6.1 Anti-Pattern: Memory Search Burden
**Description**: Require agent to search its own memory for relevant context.

**Why Avoid**: Agent may forget, search incorrectly, or skip.

**Fabric Current**: Recall is hook-driven (good), but agent must still choose to read bodies.

**Better**: Passive injection of bodies for high-confidence matches.

### 6.2 Anti-Pattern: Blanket Approval Gates
**Description**: Require approval for all operations regardless of stakes.

**Why Avoid**: Approval fatigue, users auto-approve without reading.

**Fabric Current**: Cite policy requires explicit action for all recalls.

**Better**: Responsive salience — approval only for low-confidence or high-stakes.

### 6.3 Anti-Pattern: Static UI Intensity
**Description**: Same UI complexity for all users and all tasks.

**Why Avoid**: Overwhelms beginners, frustrates experts.

**Fabric Current**: Same hook output, same cite requirements for all.

**Better**: Adaptive intensity based on user expertise and task risk.

## 7. Summary

**Core Insight from InKH**: "Complexity should be absorbed by the system, not transferred to the user."

**Key Recommendations**:
1. **Passive Injection**: Already partially implemented via hooks, needs bounded buffer and decay
2. **Responsive Salience**: Add user expertise tracking and task risk assessment
3. **Progressive Disclosure**: Show summaries, expand on demand
4. **Epistemic UI**: Visualize confidence, provenance, store origin
5. **Intentional Friction**: Apply surgically, not uniformly
6. **Wiki Audit Surface**: Reduce terminal noise, provide governance

**Implementation Priority**:
1. Short-term: Progressive disclosure for cite policy (show summary only)
2. Medium-term: Responsive salience for self-archive trigger
3. Long-term: Temporal knowledge graph, wiki audit surface
