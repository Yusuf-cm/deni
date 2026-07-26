# Deni

An AI collections assistant for Kenyan SMEs that sell on credit.

Deni doesn't just help you collect debts — it stops you from creating bad ones.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

Open the app and press **Load demo data** to get a populated shop.

### Optional: real Claude

```bash
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
```

Without a key the app runs a deterministic rule-based engine for all five AI
tasks. Every feature works either way — extraction handles fewer phrasings and
the reminders are templated rather than written fresh. The dashboard shows an
"Offline rules" badge when it's running without a key.

## Test

```bash
npm run build && npm start -- -p 3100     # in one terminal
npm test                                  # in another
```

75 checks: the API contract for all five AI tasks, then a real browser driven
through the whole workflow (seed → extract → credit warning → reminder →
wa.me hand-off → promise → M-Pesa payment → clearing → persistence →
validation → AI-unreachable fallback). Screenshots land in `screens/`.

## How it works

Three screens — dashboard, new debt, debt detail — over `localStorage`. No
database, no accounts, no build step beyond Next.js.

**Scoring is code, not a model call.** Priority, tone escalation and customer
reliability are deterministic functions in `src/lib/priority.ts`, `tone.ts` and
`derive.ts`. That makes the ranking instant, free and explainable; Claude is
only asked to put the reasoning into words. The five model tasks are extraction,
reminder writing, reply classification, M-Pesa matching and ranking prose — all
in `src/app/api/ai/route.ts` behind forced tool calls, so responses are always
validated JSON.

**Priority** is `balance × age multiplier × decay-urgency × broken-promise
multiplier`. Collection probability drops as debt ages, so old money outranks
new money of the same size.

**Tone** rises with days overdue and promises broken, never with mood. Two
broken promises or 45 days late reaches "final" — which still never threatens.

**Credit memory** is the point of the whole thing: when you record a new debt
for someone already in your book, Deni warns you before you save.

## Deploy

Any Node host. On Vercel:

```bash
npx vercel --prod
```

Set `ANTHROPIC_API_KEY` in the project's environment variables if you want the
real model. Nothing else is required — there is no database to provision.

Note that debts live in the browser's `localStorage`, so each device holds its
own book. That is deliberate for a demo; a shared backend is the first thing to
add for real use.
