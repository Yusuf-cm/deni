# Deni MVP — Build Scope

One-line pitch: **Deni doesn't just help you collect debts — it stops you from creating bad ones.**

This document is the single source of truth for the MVP. If a feature isn't listed here, it's out.

---

## 1. MVP boundary

### In scope
1. Create a debt: manual form **or** paste text (WhatsApp thread / invoice / plain text) → Claude extracts fields → user confirms → saved.
2. Credit-memory warning at creation time ("this customer already owes / paid late before").
3. Dashboard: exposure headline, priority-ranked debt list with explainable scores.
4. Reminder drafting (English / Swahili / Sheng, tone escalates from customer behavior) → send via `wa.me` deep link.
5. Log a customer reply → Claude parses promise-to-pay → broken promises escalate tone automatically.
6. Record payment: manual entry **or** paste M-Pesa SMS → Claude matches to debt → partial payments supported → balance updates.
7. Seed demo data + scripted demo path.

### Explicitly out (do not build)
- Authentication, user accounts, multi-device sync
- Server database (SQLite included) — **localStorage only**
- WhatsApp Business API, SMS gateways, payment gateways
- Multi-currency (KES hardcoded everywhere)
- Inventory, expenses, bookkeeping, reports/exports
- Charts libraries, state-management libraries, i18n frameworks
- Editing debt history / audit trails

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | `npx create-next-app@latest deni --typescript --tailwind --app` |
| UI | Tailwind CSS + shadcn/ui | Components listed in §7 |
| AI | Anthropic SDK, server-side only | Single API route, model `claude-sonnet-5` (drop to `claude-haiku-4-5-20251001` if cost matters — extraction quality is the only thing that suffers) |
| Storage | `localStorage` via one custom hook | No ORM, no DB |
| State | React state + one context provider | No Redux/Zustand |

`ANTHROPIC_API_KEY` in `.env.local`. The key never reaches the client — all AI calls go through `/api/ai`.

---

## 3. Data model (`lib/types.ts`)

```ts
export interface Customer {
  id: string;            // crypto.randomUUID()
  name: string;
  phone: string;         // normalized: "2547XXXXXXXX"
}

export interface Debt {
  id: string;
  customerId: string;
  principal: number;     // KES, integer
  balance: number;       // principal minus payments
  description: string;
  createdAt: string;     // ISO date
  dueDate: string;       // ISO date
  dueDateAssumed: boolean; // true if Claude applied the 30-day default
  status: 'open' | 'partial' | 'paid';
  payments: Payment[];
  promises: PromiseToPay[];
  reminders: Reminder[];
}

export interface Payment {
  id: string;
  amount: number;
  date: string;
  source: 'manual' | 'mpesa';
  mpesaRef?: string;     // e.g. "SFJ3K2LM9Q"
  note?: string;
}

export interface PromiseToPay {
  id: string;
  promisedDate: string;
  madeAt: string;
  status: 'pending' | 'kept' | 'broken'; // recomputed on load: pending + past date + no covering payment = broken
}

export interface Reminder {
  id: string;
  tone: 'friendly' | 'professional' | 'firm' | 'final';
  language: 'english' | 'swahili' | 'sheng';
  text: string;
  sentAt: string;        // set when wa.me link is opened
}
```

**Derived values — computed in `lib/derive.ts`, never stored:**

```ts
daysOverdue(debt)        // max(0, today - dueDate)
customerStats(customerId, debts) => {
  totalOwed,             // sum of open balances
  debtCount,
  avgDaysToPay,          // from paid debts: last payment date - createdAt
  brokenPromises,        // count across all debts
  reliability: 'good' | 'watch' | 'risky'
  // good: no broken promises, avgDaysToPay <= 7 past due or no history
  // watch: 1 broken promise OR pays 8–30 days late
  // risky: 2+ broken promises OR pays >30 days late OR has debt >60 days overdue
}
```

**Priority score — deterministic, in code, NOT an AI call** (transparent, free, instant; Claude only phrases the explanation):

```ts
// lib/priority.ts
recoveryFactor(daysOverdue): 1.0 (≤30d) | 0.7 (31–60d) | 0.5 (61–90d) | 0.3 (>90d)
score(debt) = debt.balance
            * (1 + daysOverdue / 30)
            * (2 - recoveryFactor)          // older money is more urgent to chase
            * (1 + 0.5 * brokenPromises)
tier: score >= P75 of open debts → 'high'; >= P40 → 'medium'; else 'low'
```

**Tone escalation — deterministic, in code:**

```ts
// lib/tone.ts
suggestedTone(debt, stats):
  not yet due                          → 'friendly'
  overdue ≤ 14d, 0 broken promises     → 'professional'
  overdue > 14d OR 1 broken promise    → 'firm'
  overdue > 45d OR 2+ broken promises  → 'final'
```

**Storage (`lib/store.ts`):** two localStorage keys, `deni:customers` and `deni:debts`. One `useDeni()` context hook exposing `{ customers, debts, addDebt, addPayment, addPromise, addReminder, markPaid }`. Every mutation writes back to localStorage synchronously. On load, recompute promise statuses (pending → broken if date passed).

**Phone normalization (`lib/phone.ts`):** `07XXXXXXXX` / `+2547...` / `2547...` / `01XX...` → `254XXXXXXXXX`. Reject anything that doesn't normalize; show inline error.

---

## 4. AI layer — one route, five tasks

`POST /api/ai` with body `{ task, payload }`. Server-side Anthropic SDK call using a **forced tool call** (one tool per task whose input schema is the desired JSON) so responses are validated JSON, never free text. Max ~1s of prompt each; no streaming needed.

### Task: `extract`
- **In:** `{ text }` (pasted WhatsApp thread / invoice / anything)
- **Out:** `{ customerName, phone, amount, dueDate, description, confidence: 0–1, assumptions: string[] }`
- **Rules in system prompt:** KES only. Never invent a phone number or amount — return null and lower confidence. If no due date is stated, set `dueDate = createdAt + 30 days` and add `"Due date assumed (30-day default)"` to `assumptions`. Phrases like "mwisho wa mwezi" → last day of current month, listed as an assumption.
- **Client behavior:** confidence < 0.7 OR any null required field → confirmation form opens with missing fields highlighted and save disabled until filled. Assumptions always rendered as amber chips on the confirmation screen.

### Task: `remind`
- **In:** `{ customerName, balance, daysOverdue, dueDate, description, tone, language, brokenPromises, lastReminderDate }`
- **Out:** `{ message }`
- **Rules:** ≤ 60 words, WhatsApp register, includes exact KES amount, no threats/harassment ever (even 'final' stays lawful and respectful — it states next steps like pausing further credit). Sheng: casual but never disrespectful.

### Task: `parse_reply`
- **In:** `{ replyText, debt summary }`
- **Out:** `{ intent: 'promise' | 'dispute' | 'paid_claim' | 'other', promisedDate: string|null, summary }`
- **Client behavior:** intent `promise` → confirm dialog → `addPromise`. `dispute`/`paid_claim` → show summary, no auto-action.

### Task: `match_payment`
- **In:** `{ smsText, openDebts: [{id, customerName, phone, balance}] }`
- **Out:** `{ debtId|null, amount, mpesaRef, payerName, confidence, reasoning }`
- **Rules:** match on sender name and/or phone against open debts. No confident match → `debtId: null`; client shows a picker with the parsed amount pre-filled.

### Task: `explain_priority`
- **In:** the top 5 debts with their computed scores, tiers, stats
- **Out:** `{ explanations: [{ debtId, reasoning }] }` — one sentence each, e.g. *"45 days overdue, one broken promise, and KES 15,000 is your largest at-risk balance."*
- Called once per dashboard load (cache in memory for the session); everything else on the dashboard renders instantly from local computation.

Error handling: any AI failure → toast "AI unavailable — you can enter this manually" and fall back to the manual form. The app must be fully operable with the API down (only drafting/extraction degrade).

---

## 5. Routes & screens

### `/` — Dashboard (the main screen)
- **Exposure header:** "KES 47,000 locked in deni" (sum of open balances) + subline "KES 12,000 at risk" (balances of debts >60d overdue) + small stats row: customers owing, overdue count, due today, collected this month.
- **Priority list:** open debts sorted by score desc. Card: customer name, balance (KES formatted), days overdue badge (green/amber/red), tier chip (High/Medium/Low), reliability chip, last reminder date, one-line Claude explanation for the top tier. Tap → detail.
- **FAB / header button:** "New debt".

### `/new` — Create debt
- Two tabs: **Paste** (big textarea + "Extract with AI" button → confirmation form) and **Manual** (same form, empty).
- Confirmation form: name, phone, amount, due date, description; amber assumption chips; **credit-memory banner** when the (normalized-phone or name) matches an existing customer: "⚠ Mama Njeri already owes KES 3,400 (22 days overdue), 1 broken promise. Consider cash-only." Save → upserts customer, creates debt, routes to dashboard.

### `/debt/[id]` — Debt detail
- Header: customer, balance vs principal, status, due date (with "assumed" tag if applicable), reliability.
- Timeline: created / reminders / promises (with kept-broken-pending state) / payments, newest first.
- Actions (buttons, each opening a sheet/dialog):
  1. **Draft reminder** — tone pre-selected from `suggestedTone()` (user can override), language picker, generated message in an editable textarea, "Regenerate" + "Open WhatsApp" (`https://wa.me/{phone}?text={encodeURIComponent(message)}`; clicking also records the Reminder).
  2. **Log reply** — paste customer reply → `parse_reply` → confirm promise.
  3. **Record payment** — two tabs: paste M-Pesa SMS (`match_payment`, but scoped to this debt so it just extracts amount/ref) or manual amount+date+note. Payment reduces balance; balance 0 → status `paid`; partial → `partial`. A payment on/before a pending promise date covering ≥ the promise → promise `kept`.

### Layout
Mobile-first, max-width ~480px centered on desktop. Bottom padding for FAB. `Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 })` everywhere.

---

## 6. Seed data (`lib/seed.ts`)

"Load demo data" button on empty dashboard. Three customers engineered to show every state:
1. **Mama Njeri** — risky: one debt 45d overdue (KES 15,000), one broken promise, one prior partial payment. (High priority — the demo star.)
2. **John Kamau** — watch: KES 8,000 due in 2 days, no history.
3. **Wanjiku Stores** — good: KES 5,000 paid this month (feeds "collected this month").

Also keep in the doc, for pasting live in the demo:
- A WhatsApp thread in Swahili/English mix where goods go on credit with "nitalipa mwisho wa mwezi".
- A customer reply: "Boss nisamehe, nitatuma pesa Friday bila fail."
- A realistic M-Pesa SMS: `SFJ3K2LM9Q Confirmed. Ksh2,000.00 received from JOHN KAMAU 254712345678 on 26/7/26 at 2:14 PM. New M-PESA balance...`

---

## 7. shadcn/ui components to install

`button card badge input textarea tabs dialog sheet select label sonner skeleton`

---

## 8. Build order

Each phase ends with something demoable. Rough solo-dev timings.

**Phase 0 — Scaffold (≈1h):** create-next-app, Tailwind, shadcn init + components, `types.ts`, `store.ts` + provider, `phone.ts`, KES formatter, empty dashboard rendering from store.

**Phase 1 — Manual core loop (≈2.5h):** manual debt form → dashboard list → debt detail → manual payment → partial/paid transitions → exposure header. *App is already useful with zero AI.*

**Phase 2 — AI extraction (≈2h):** `/api/ai` route + Anthropic SDK plumbing, `extract` task, Paste tab, confirmation form with assumptions + confidence gating, credit-memory banner.

**Phase 3 — Reminders (≈2h):** `priority.ts` + `tone.ts`, priority-sorted dashboard with tier chips, `remind` task, reminder sheet, wa.me link, reminder logged to timeline, `explain_priority` on dashboard.

**Phase 4 — Payments & promises via paste (≈2h):** `match_payment` (M-Pesa SMS tab), `parse_reply` (Log reply), promise kept/broken recomputation, escalation now visibly driven by broken promises.

**Phase 5 — Polish + demo (≈2h):** seed data, empty states, loading skeletons, error toasts, mobile pass, run the demo script end-to-end five times.

**Total: ~11–12 hours.** If time runs out, cut from the end: `explain_priority` first (tiers still show), then `parse_reply` (promises entered via a manual date picker instead).

---

## 9. Demo script (~90 seconds)

1. Dashboard with seed data — exposure headline, Mama Njeri at #1 with Claude's one-line reasoning.
2. Paste the live WhatsApp thread → extraction with "due date assumed: end of month" chip → **credit-memory warning fires** (returning customer) → save.
3. Open Mama Njeri → tone pre-set to Firm (45d overdue + broken promise) → generate Swahili reminder → tap → WhatsApp opens pre-filled.
4. Back in app: paste her reply → Claude logs "promises Friday".
5. Paste the M-Pesa SMS → auto-matched to John Kamau → KES 2,000 partial payment → balance and dashboard update live.
6. Close on the dashboard: collected-this-month ticked up, exposure down.

---

## 10. Acceptance checklist

- [ ] Debt created from pasted Swahili/English WhatsApp text with correct fields and visible assumptions
- [ ] Missing due date → 30-day default, flagged, never silently invented
- [ ] Extraction confidence < 0.7 blocks save until user completes the form
- [ ] Returning customer triggers credit-memory warning before save
- [ ] Dashboard ranks by priority score with visible tier + reasoning
- [ ] Reminder tone auto-escalates from overdue days + broken promises; all four tones generate in all three languages; nothing threatening
- [ ] wa.me opens with the message prefilled on a phone
- [ ] Pasted M-Pesa SMS records a partial payment against the right debt; unmatched SMS falls back to a picker
- [ ] Balance math correct across multiple partial payments; paid state reached at 0
- [ ] Everything except AI drafting/extraction works offline / with API down
- [ ] KES formatting everywhere; usable one-handed on a phone
