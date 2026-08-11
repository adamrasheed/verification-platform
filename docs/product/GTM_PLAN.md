# Go-to-Market Plan

**Status:** Launch plan
**Owner:** Founding Team
**Planning horizon:** First 90 days after launch readiness
**Product boundary:** Market only capabilities supported by committed release
Evidence

## Executive decision

Lead with the narrow, working product—not the full platform vision:

> Verify tells JavaScript and TypeScript teams whether an AI-generated workspace
> change is actually coherent, with a deterministic local verdict and retained
> Evidence.

The initial wedge is AI-assisted npm, pnpm, and Yarn monorepos. The free CLI is
the acquisition product, the GitHub Action creates team habit, the local MCP
server makes the verifier available to coding agents, and the future hosted
metadata service becomes the paid collaboration and governance layer.

Do not launch as a generic “AI code quality platform.” That category is crowded
and vague. Own the sharper idea of **evidence-backed completion**: an agent can
claim that work is done, but an independent verifier decides whether a supported
promise is satisfied.

## Why now

The market signal is not that developers reject AI. It is that they use it while
distrusting its output:

- The [2025 Stack Overflow Developer Survey](https://survey.stackoverflow.co/2025/ai/)
  reports that 46% of respondents distrust AI-tool accuracy versus 33% who trust
  it; 66% cite solutions that are almost right as a frustration.
- The same survey reports that 87% are concerned about agent accuracy and 81%
  about security or data privacy.
- [GitHub Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/)
  reports 43.2 million merged pull requests per month, 4.3 million AI projects,
  and TypeScript becoming GitHub's most-used language in August 2025.

The opportunity is the gap between faster code production and slower confidence.
Verify should sell confidence that is inspectable, local-first, and compatible
with both humans and agents.

## Ideal customer profile

Start with one primary ICP and one expansion ICP.

| ICP | Trigger | Buyer | Daily user | Pain worth solving |
|---|---|---|---|---|
| AI-native TypeScript team, 3–30 engineers | frequent agent-generated PRs in an npm/pnpm/Yarn monorepo | founder or engineering lead | developers and coding agents | plausible workspace edits fail later or consume review time |
| Platform team, 30–200 engineers | multiple coding tools and inconsistent CI interpretations | platform/DevEx lead | application teams | no common machine-readable definition of “verified” |

The first design partners should have:

- a JavaScript or TypeScript monorepo;
- at least weekly use of a coding agent;
- an engineer who owns CI or developer experience;
- a recent dependency, lockfile, or workspace incident; and
- willingness to install a free local tool before discussing hosted features.

Deprioritize single-package repositories, teams seeking a replacement for their
test suite, and enterprises requiring a production hosted SLO before the
production observation window exists.

## Positioning and message

### Positioning statement

For JavaScript and TypeScript teams shipping AI-generated changes, Verify is
verification infrastructure that turns a completion claim into an
evidence-backed verdict. Unlike another AI reviewer or CI dashboard, Verify runs
one deterministic, local-first engine across the terminal, coding agents, and
GitHub—and keeps source and secrets local by default.

### Message hierarchy

1. **Outcome:** Know whether the change is actually done.
2. **Proof:** Every verdict cites retained, revision-addressed Evidence.
3. **Workflow:** One command locally; the same semantics for agents and CI.
4. **Trust:** The Engine is offline and read-only; source and secrets stay local.
5. **Expansion:** Add more application promises without changing the verification
   model.

### Words to use

- evidence-backed verdict
- independent verification
- local-first and deterministic
- agent-readable
- one engine across local, agent, and CI workflows

### Words to avoid

- “proves all AI code is correct”
- “replaces tests, CI, or code review”
- “production-ready hosted platform” before production Evidence exists
- broad claims about authentication, billing, or runtime verification before
  those providers ship

## Product-led funnel

```text
Problem content / npm / GitHub
  → first `npx ... verify .`
  → first useful verdict in under five minutes
  → GitHub Action or MCP habit
  → repeated team verification
  → hosted metadata design partner
  → paid team governance
```

### Acquisition

Use the channels closest to the product:

1. npm search and package README;
2. GitHub repository, release pages, and examples;
3. a separately packaged public GitHub Action listing;
4. technical posts showing real broken-workspace fixtures;
5. founder-led outreach to AI-native TypeScript teams; and
6. launch communities only after the activation path is polished.

GitHub requires a Marketplace Action repository to contain a root action
metadata file and recommends a repository dedicated to the Action. Follow the
[official Marketplace publishing requirements](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace?learn=create_actions)
instead of trying to list the current monorepo layout directly.

### Activation

The activation event is not install or download. It is:

> A developer runs Verify against a real repository, receives a completed
> verdict, and can explain the result or next action.

Activation requirements:

- copy-paste command works without an account;
- first result completes in under five minutes on the supported repository;
- a violation includes a stable reason and useful Evidence reference;
- an unsupported repository is clearly distinguished from a broken verifier;
- the README exposes the exact current scope before platform abstractions.

### Retention

The first retention loop is a required pull-request check, not a dashboard.
Encourage activated users to add the Action after two useful local runs. Agent
users should add the local MCP adapter when they want the agent to inspect
retained results without write authority.

### Revenue

Keep the local verifier open and free. Test willingness to pay for shared
history and policy—not for the first verdict.

| Tier hypothesis | Price hypothesis | Value boundary |
|---|---:|---|
| Community | Free | CLI, local history, local MCP, public Action |
| Team | $99/month for 10 active contributors, then $10 each | shared metadata history, team policy, retention, hosted coordination |
| Enterprise | Design-partner pricing first | SSO, longer retention, support, governance, deployment controls |

These are interview hypotheses, not launch commitments. Ask the first ten design
partners what budget owns the problem, then price against avoided review and
incident time. Do not add billing until at least three teams repeatedly use the
free workflow and explicitly ask for a shared capability.

## Launch prerequisites

Ship the public launch only when all items below are true:

- README scope and examples match the published package;
- one-command install is tested from a clean supported workspace;
- npm release uses trusted publishing and provenance;
- public Action distribution has an immutable release and major-version tag;
- Action installation instructions work in a clean public repository;
- issue templates capture false positive, false negative, unsupported workspace,
  and integration friction separately;
- a five-minute demo shows both satisfied and violated results;
- at least three external design partners have completed a real run; and
- no hosted reliability or availability claim exceeds retained production
  Evidence.

[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) uses OIDC,
removes long-lived publishing tokens, and automatically generates provenance for
eligible public packages. Preserve that trust signal in every release.

## 90-day execution plan

### Days 0–14: make the wedge undeniable

- Release the current CLI under a clear changelog and provenance-backed tag.
- Create two tiny public demo repositories: one satisfied, one with a duplicate
  workspace name and a supported Repair.
- Record a 60–90 second terminal demo: agent claim → violated verdict → Repair
  preview → explicit apply → satisfied re-verification.
- Prepare the dedicated Action distribution repository and Marketplace listing.
- Recruit ten design-partner candidates from direct founder relationships,
  TypeScript open-source maintainers, and AI-native product teams.
- Run five observed onboarding sessions; log time-to-result and every point of
  confusion.

Exit criteria: five real repositories run, at least three useful verdicts, and
median time-to-first-result below five minutes.

### Days 15–30: earn repeat use

- Convert successful local users to the Action in the same week.
- Publish three problem-led articles:
  1. “The agent said done; the workspace was not coherent.”
  2. “Why compile success is not dependency-integrity Evidence.”
  3. “A local-first verification boundary for coding agents.”
- Add copy-paste CI and MCP recipes for Claude, Codex, Cursor, and generic stdio
  MCP clients without implying endorsement.
- Conduct ten problem interviews using the user's last real incident, not a
  feature pitch.

Exit criteria: ten activated teams, five with a second-week run, and three Action
installations.

### Days 31–60: public launch

- Publish the GitHub Action and an npm release together.
- Launch with one concrete story and demo on Hacker News, relevant TypeScript and
  monorepo communities, LinkedIn/X, and developer newsletters.
- Ask every design partner for one of: a public repository example, a short quote,
  or permission to publish an anonymized failure pattern.
- Hold weekly office hours for installation and false-positive review.
- Create comparison pages around workflows, not competitors: “Verify plus tests,”
  “Verify for coding agents,” and “Verify in pull requests.”

Exit criteria: 50 distinct repositories verified, 15 Action installations, ten
weekly active repositories, and no unresolved high-severity false positive.

### Days 61–90: find the paid boundary

- Invite the five most active teams into the hosted metadata design-partner
  program only after production Evidence permits it.
- Test shared history, organization policy, and retention as separate value
  propositions.
- Ask for a paid pilot before building enterprise administration.
- Expand the Proof roadmap from observed incidents; do not choose the next
  provider from abstract market size alone.
- Publish the first evidence-backed benchmark and an anonymized “failure patterns
  found” report.

Exit criteria: five retained teams, three hosted design partners, and one to
three paid pilots or an explicit, documented reason the paid boundary is wrong.

## Founder-led sales motion

Use a short, evidence-oriented outreach message:

> I’m building Verify, a local-first checker for AI-generated TypeScript
> workspaces. It currently catches manifest, workspace identity, local dependency,
> and lockfile ownership failures and returns machine-readable Evidence. If you
> have a monorepo and use coding agents, I’d like to run it on one real branch
> with you. No source leaves the machine and there is nothing to buy in the first
> session.

In discovery, ask:

1. Tell me about the last AI-generated change that looked done but failed later.
2. Where was the problem first visible, and who spent time diagnosing it?
3. What does your team currently require before accepting an agent's work?
4. Which result would need to appear in a pull request to change behavior?
5. What data may never leave the repository or CI boundary?
6. Who owns budget for reducing this class of failure?

End each session with an observable next step: run on a branch, install the
Action, or decline because the current Proof set is irrelevant.

## Metrics and instrumentation

### North-star metric

**Weekly Verified Workspaces:** distinct workspaces that receive at least one
completed satisfied, violated, or indeterminate result in a seven-day period.

This measures delivered verification value without rewarding repeated retries
or raw package downloads.

### Funnel metrics

| Stage | Metric | 90-day target |
|---|---|---:|
| Reach | npm weekly downloads | directional, not a success metric |
| Activation | distinct real repositories with a completed result | 50 |
| Value | repositories receiving a useful violation or trusted satisfaction | 30 |
| Habit | repositories verified in 3 of 4 weeks | 10 |
| Team adoption | active Action installations | 15 |
| Expansion | hosted design partners | 3 |
| Revenue signal | paid pilots | 1–3 |

The local Engine should not add undisclosed telemetry. Measure public package and
repository activity, voluntary onboarding sessions, Action usage available to
the repository owner, and explicitly consented hosted metadata. Publish the
measurement boundary.

## Experiment backlog

| Hypothesis | Test | Pass signal | Decision if false |
|---|---|---|---|
| “Agent said done” is a stronger hook than “verification infrastructure” | README/landing headline interviews | 7 of 10 ICP users restate the value correctly | lead with concrete workspace failures |
| A useful violation drives adoption | five observed runs | 3 teams install in CI after a violation | broaden the Proof set before scaling reach |
| Local-first is a purchase enabler | problem interviews | privacy boundary appears unprompted in 5 of 10 | reduce prominence, keep it as trust proof |
| Shared Evidence history is payable | hosted prototype interviews | 3 teams agree to a paid pilot | test policy enforcement or support instead |
| Repair is a retention driver | cohort comparison | Repair users have materially higher week-2 reuse | keep Repair secondary in acquisition messaging |

## Operating principles

- Market the measured capability, then expand the claim after Evidence lands.
- Prefer one useful violated result over thousands of low-intent downloads.
- Use failure examples and terminal output more than architecture diagrams.
- Keep the verifier independent from the code generator in both product and
  message.
- Treat false positives as trust incidents and false negatives as roadmap input.
- Do not hide “unsupported” inside “passed.”
- Keep Windows production claims on hold until the signed sandbox work resumes
  and passes its own release gates.
