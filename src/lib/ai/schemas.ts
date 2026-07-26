/** Tool schemas + system prompts. One entry per AI task. */

export type AiTask = 'extract' | 'remind' | 'parse_reply' | 'match_payment' | 'explain_priority'

interface TaskSpec {
  system: string
  toolName: string
  toolDescription: string
  schema: Record<string, unknown>
  maxTokens: number
}

const NO_INVENTION = `Never invent a fact. If a value is not present in the text, return null for it and lower your confidence. It is always better to leave a field empty than to guess it.`

export const TASKS: Record<AiTask, TaskSpec> = {
  extract: {
    system: `You extract credit-sale ("deni") records for a Kenyan small business owner from raw text: pasted WhatsApp threads, invoices, or notes. The text is often a mix of English, Kiswahili and Sheng.

${NO_INVENTION}

Rules:
- All amounts are Kenyan Shillings. Return a plain integer, no separators or currency symbol.
- The customer is the person who OWES money, not the business owner. In a WhatsApp thread the owner is usually the one selling or the one saying "nitakutumia" the goods.
- Phone numbers: return exactly as they appear in the text; do not fabricate one.
- Due dates: today's date is supplied in the user message. Resolve relative phrases against it ("mwisho wa mwezi" / "end month" = last day of the current month, "kesho" = tomorrow, "wiki ijayo" = 7 days). Return ISO yyyy-mm-dd.
- If NO due date is stated anywhere, set dueDate to exactly 30 days after today and add "Due date assumed: 30-day default" to assumptions.
- Record every inference you made in assumptions, in plain English the shop owner can read.
- confidence reflects how sure you are of the whole record: 0.9+ only when name, phone, amount and an explicit due date are all clearly present.`,
    toolName: 'record_debt',
    toolDescription: 'Return the debt fields extracted from the text.',
    maxTokens: 1024,
    schema: {
      type: 'object',
      properties: {
        customerName: { type: ['string', 'null'], description: 'Name of the person who owes money' },
        phone: { type: ['string', 'null'], description: 'Their phone number exactly as written' },
        amount: { type: ['number', 'null'], description: 'Amount owed in KES, integer' },
        dueDate: { type: ['string', 'null'], description: 'ISO yyyy-mm-dd' },
        description: { type: 'string', description: 'What was sold, in a few words' },
        confidence: { type: 'number', description: '0 to 1' },
        assumptions: { type: 'array', items: { type: 'string' } },
      },
      required: ['customerName', 'phone', 'amount', 'dueDate', 'description', 'confidence', 'assumptions'],
    },
  },

  remind: {
    system: `You write WhatsApp payment reminders for a Kenyan small business owner chasing money owed to them.

Hard rules:
- Under 60 words. One message, ready to send. No subject line, no signature block, no quotation marks around it.
- State the exact amount in KES and what it was for.
- Never threaten, shame, insult, or mention police, auctioneers, courts or debt collectors. Even the "final" tone stays lawful and respectful — it simply states that no further credit will be extended until the balance is cleared.
- Preserve the relationship: this is a customer the owner wants to keep.
- Match the requested language exactly. english = clear simple English. swahili = natural conversational Kiswahili, not textbook. sheng = Nairobi street register, warm and casual, still respectful — never rude.
- Tone ladder: friendly = light nudge. professional = polite and businesslike. firm = direct, states the delay plainly, asks for a specific commitment. final = serious but calm, states the consequence of no further credit.
- If the customer has broken promises, reference it factually and without sarcasm.`,
    toolName: 'write_reminder',
    toolDescription: 'Return the WhatsApp reminder message.',
    maxTokens: 512,
    schema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  },

  parse_reply: {
    system: `You read a customer's WhatsApp reply to a payment reminder and classify it for a Kenyan business owner. Text may be English, Kiswahili or Sheng.

${NO_INVENTION}

intent:
- "promise" — they commit to paying at some future point ("nitatuma Friday", "next week bila fail").
- "paid_claim" — they say they have ALREADY paid or sent money.
- "dispute" — they disagree with the amount, the goods, or that they owe at all.
- "other" — anything else, including silence-fillers and greetings.

For "promise", resolve the promised date against today's date (given in the user message) and return ISO yyyy-mm-dd. A bare weekday means the next occurrence of that weekday. If they promise but give no timeframe at all, return null for promisedDate.
summary: one short sentence for the owner, in English.`,
    toolName: 'classify_reply',
    toolDescription: 'Return the classification of the customer reply.',
    maxTokens: 512,
    schema: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: ['promise', 'paid_claim', 'dispute', 'other'] },
        promisedDate: { type: ['string', 'null'] },
        summary: { type: 'string' },
      },
      required: ['intent', 'promisedDate', 'summary'],
    },
  },

  match_payment: {
    system: `You read an M-Pesa confirmation SMS and match it to one of the business owner's outstanding debts.

${NO_INVENTION}

- Extract the amount in KES, the M-Pesa transaction reference (the code at the start of the message), and the payer's name as written.
- Match against the supplied open debts using the payer's name and phone number. Names may be in a different order or partially abbreviated.
- If no debt is a confident match, return null for debtId and say why in reasoning. Do not guess between two similar customers.
- reasoning is one short sentence for the owner.`,
    toolName: 'match_mpesa_payment',
    toolDescription: 'Return the parsed payment and the debt it belongs to.',
    maxTokens: 512,
    schema: {
      type: 'object',
      properties: {
        debtId: { type: ['string', 'null'] },
        amount: { type: ['number', 'null'] },
        mpesaRef: { type: ['string', 'null'] },
        payerName: { type: ['string', 'null'] },
        confidence: { type: 'number' },
        reasoning: { type: 'string' },
      },
      required: ['debtId', 'amount', 'mpesaRef', 'payerName', 'confidence', 'reasoning'],
    },
  },

  explain_priority: {
    system: `You explain to a Kenyan business owner why each debt sits where it does in their follow-up queue.

You are given debts that have ALREADY been scored and ranked by the app. Do not re-rank them and do not introduce numbers you were not given. Write one sentence per debt, under 20 words, naming the concrete reasons (amount, days overdue, broken promises, customer history). Plain English, no jargon, no greetings.`,
    toolName: 'explain_ranking',
    toolDescription: 'Return one explanation per debt.',
    maxTokens: 1024,
    schema: {
      type: 'object',
      properties: {
        explanations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              debtId: { type: 'string' },
              reasoning: { type: 'string' },
            },
            required: ['debtId', 'reasoning'],
          },
        },
      },
      required: ['explanations'],
    },
  },
}
