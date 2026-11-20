# The Sandwich Project — Organizational Overview

*Last updated: June 10, 2026*

> This overview was deduced entirely from the contents of this application — its data
> model, workflows, grant-reporting logic, permission roles, and the operational rules
> baked into the code. It describes how the organization appears to run as reflected by
> the software that supports it. Figures marked as goals, methodology, or benchmarks are
> the organization's own stated assumptions, not necessarily live totals.

---

## What they do

The Sandwich Project is a volunteer-driven nonprofit fighting hunger and food waste in
**metro Atlanta** by making and distributing sandwiches to people in need. The whole
organization runs on one simple, repeatable loop — but at real scale, across a
distributed network of homes, groups, and partner agencies.

---

## Who they serve

The codebase organizes recipients into focus populations, which tells you who's on their
mind:

- Unhoused people (including emergency shelters)
- Youth and seniors
- Families (including single-parent and Hispanic families)
- Veterans
- LGBTQ+ and health-related programs (HIV, substance-abuse support)
- Justice-involved people (incarceration and reentry)
- Trafficking survivors
- Refugees and immigrants

They serve **through partner organizations** rather than handing food out directly —
recipients in the system are agencies, and the org tracks whether each has a **signed
contract** (a grant-transparency signal).

---

## Where they operate

Squarely **Atlanta metro**, mapped to regions — North Fulton, Cobb, DeKalb, South
Fulton, and Gwinnett — and dozens of named cities (Sandy Springs, Dunwoody, Buckhead,
Roswell, Alpharetta, Marietta, Decatur, Clarkston, and more). The intake form even has an
**"outside our typical operating areas"** flag, so geography is an active operational
boundary, not just a label.

---

## How the work actually flows

The core model has four moving parts:

1. **Hosts** — roughly 34–35 active "host homes," plus organized **group builds**
   (schools, churches, corporate teams, community groups) where sandwiches get made.
2. **Makers / volunteers** — individuals and groups assemble sandwiches, assembly-line
   style, following food-safety guidance.
3. **Drivers** — volunteers who transport finished sandwiches, sometimes needing a
   **refrigerated van** for large or perishable loads.
4. **Recipients** — partner agencies that receive and distribute the food to the
   populations above.

**Collections** (the count of sandwiches made) are the operational source of truth,
logged on a weekly **Wednesday–Tuesday** cycle.

---

## How events come in and get run

There's a full intake-and-follow-up machine around **group events**:

- A request comes in (often via a Google Sheet fed from the public site). An admin runs
  an **intake call** using a structured checklist: date, location, sandwich count, types,
  refrigeration, food-safety flags, corporate status, and contact info.
- The form auto-creates **"next action" to-dos** for anything needing leadership
  sign-off — scheduling conflicts, out-of-area events, sub-200-sandwich events, van
  needs, refrigeration exemptions, or young children making PB&J.
- Behind the scenes, **scheduled jobs** chase events with tiered reminders: toolkit not
  sent within 24 hours, no activity in 7 days, escalations to admin, plus 24-hour and
  1-hour volunteer reminders
  before each event.

---

## Who runs it (the human structure)

The role system maps cleanly onto a real org chart:

| Role | Who they are |
| :--- | :--- |
| `super_admin` / `admin` | Leadership / operations — full oversight |
| `core_team` | Operational staff managing hosts, recipients, drivers, volunteers, events |
| `committee_member` | Strategic volunteers on Grants, Events, Web committees |
| `host` | Site hosts who log collections and access host resources |
| `driver` | Logistics volunteers who transport sandwiches |
| `volunteer` | General volunteers who sign up for events and log counts |
| `recipient` | Partner-agency staff with a simplified, limited view |
| `viewer` / `reviewer` / `demo_user` | Read-only access for auditors and grant reviewers |

Named individuals in the code suggest a **small, centralized leadership**:

- **Christine and Marcy** are the decision-makers every exception routes to ("consult
  Christine & Marcy").
- **Katie** (katie@thesandwichproject.org) is BCC'd on *every* outgoing email — a
  founder/ED keeping a hand on everything.
- **Scott** maintained the historical reference spreadsheet up to August 2025.

---

## Scale & impact (as the code frames it)

- **Lifetime: 2,000,000+ sandwiches** (they've passed a 2M goal).
- **Annual goal: 500,000** (now runtime-configurable).
- **Weekly target: ~10,000**, typically running **8,000–10,000/week**.
- Reference high-water marks appear in the code (e.g., a record week of ~22,500, and a
  strong August 2025) — best treated as internal benchmarks rather than live totals.
- Impact is translated into grant language: **~$2/sandwich**, **$4/meal (2 sandwiches)**,
  volunteer time valued at the **2025 Independent Sector rate of $36.14/hour**, and
  **estimated volunteer engagements** (not unique people) derived from sandwich
  production — see `shared/volunteer-engagement-metrics.ts`.

---

## How it's funded and what grants pay for

They run *extremely* lean. The grant narrative frames the ask as **paid coordination
capacity** — operations, group-event coordination, recipient communication, transport
logistics, reporting, tech upkeep, and follow-up — **plus one additional smaller
refrigerated van**. Pointedly *not* a big admin staff, office, or ingredient budget. They
even note they avoided a large custom-software bill by building this platform with
AI assistance and volunteer labor.

Funding priorities deduced from the data:

- Growing the **host network** beyond ~34 locations.
- Recruiting **volunteers** to hit the 10,000/week target.
- Covering **food, supplies, transport, and reimbursements**.

---

## What the codebase reveals about their values

A few things you can only learn by reading between the lines of the rules:

- **Collaboration over competition.** There's an explicit, hard rule: *never rank or
  compare hosts against each other.* The mission is total turnout, not leaderboards — a
  deliberate cultural stance.
- **Food safety is taken seriously.** Refrigeration tiers, van triggers at 500+
  sandwiches, special-exemption sign-offs, and a specific "young children + PB&J" caution
  all require leadership approval.
- **They protect a small team from burnout.** Tiered notifications (urgent / important /
  digest), batched SMS, and weekly digests all exist to *avoid alert fatigue* — a tell
  that the people running this are stretched thin.
- **Mobile-first, plain-language by necessity.** UX choices stress mobile experience and
  unambiguous button labels because the real users are hosts, drivers, and volunteers out
  in the field, not desk staff.
- **An org maturing out of spreadsheets.** The Google Sheets history, the reference Excel
  sheet "until August 2025," and the migration into this platform paint a picture of a
  grassroots effort that outgrew manual tracking and is professionalizing.
- **Corporate engagement is a growth lever.** Speaker coordination for big builds makes
  corporate groups both an impact channel and a funding/relationship pipeline.

---

## In one sentence

The Sandwich Project is a lean, volunteer-powered, leadership-centralized Atlanta
nonprofit that turns a simple sandwich into a large-scale, food-safety-conscious,
anti-competitive community effort — and this app is the operational backbone they built
(on a shoestring) to coordinate hosts, volunteers, drivers, and partner agencies while
proving their impact to funders.
