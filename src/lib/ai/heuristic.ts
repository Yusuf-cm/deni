/**
 * Deterministic fallback for every AI task.
 *
 * Used when ANTHROPIC_API_KEY is absent or the API call fails, so the app stays
 * fully operable offline. It is rule-based and deliberately conservative: it
 * returns null rather than guessing, and caps its own confidence below the
 * threshold that would let a record save without human review.
 */
import { addDays, daysBetween, endOfCurrentMonth, toISODate, parseISO } from '../format'
import { normalizePhone } from '../phone'

const WEEKDAYS: Record<string, number> = {
  sunday: 0, jumapili: 0,
  monday: 1, jumatatu: 1,
  tuesday: 2, jumanne: 2,
  wednesday: 3, jumatano: 3,
  thursday: 4, alhamisi: 4,
  friday: 5, ijumaa: 5,
  saturday: 6, jumamosi: 6,
}

function nextWeekday(from: string, target: number): string {
  const start = parseISO(from)
  const delta = (target - start.getDay() + 7) % 7 || 7
  return addDays(from, delta)
}

function findPhone(text: string): string | null {
  const m = text.match(/(?:\+?254|0)\s?[71]\d{2}[\s-]?\d{3}[\s-]?\d{3}/)
  return m ? normalizePhone(m[0]) : null
}

function findAmount(text: string): number | null {
  const tagged = [...text.matchAll(/(?:ksh?s?|kes|shs?|bob)\.?\s*([\d][\d,\s]*\d|\d)(?:\.\d+)?/gi)]
  const shorthand = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s?k\b/gi)]
  const candidates: number[] = []

  for (const m of tagged) {
    const n = Number(m[1].replace(/[,\s]/g, ''))
    if (Number.isFinite(n) && n > 0) candidates.push(n)
  }
  for (const m of shorthand) {
    const n = Number(m[1]) * 1000
    if (Number.isFinite(n) && n > 0) candidates.push(n)
  }
  if (!candidates.length) {
    // Bare numbers that look like money (>= 100, with or without separators).
    for (const m of text.matchAll(/\b\d{1,3}(?:,\d{3})+\b|\b\d{3,7}\b/g)) {
      const n = Number(m[0].replace(/,/g, ''))
      // Skip anything that is plausibly a phone number or a year.
      if (n >= 100 && n < 10_000_000 && !/^(19|20)\d{2}$/.test(m[0])) candidates.push(n)
    }
  }
  if (!candidates.length) return null
  return Math.round(Math.max(...candidates))
}

function findDueDate(text: string, today: string): { date: string | null; explicit: boolean } {
  const lower = text.toLowerCase()

  const explicitDate = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/)
  if (explicitDate) {
    const [, d, m, y] = explicitDate
    const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : parseISO(today).getFullYear()
    const parsed = new Date(year, Number(m) - 1, Number(d))
    if (!Number.isNaN(parsed.getTime())) return { date: toISODate(parsed), explicit: true }
  }
  if (/(mwisho wa mwezi|end of (the )?month|end month|mwishoni mwa mwezi)/.test(lower)) {
    return { date: endOfCurrentMonth(today), explicit: true }
  }
  if (/\b(kesho|tomorrow)\b/.test(lower)) return { date: addDays(today, 1), explicit: true }
  if (/\b(wiki ijayo|next week|wiki jayo)\b/.test(lower)) return { date: addDays(today, 7), explicit: true }
  if (/\b(mwezi ujao|next month)\b/.test(lower)) return { date: addDays(today, 30), explicit: true }
  if (/\b(leo|today)\b/.test(lower)) return { date: today, explicit: true }

  for (const [word, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return { date: nextWeekday(today, dow), explicit: true }
  }
  return { date: null, explicit: false }
}

const NOT_A_NAME = new Set([
  'me', 'you', 'yes', 'no', 'ok', 'okay', 'sawa', 'asante', 'thanks', 'boss',
  'hi', 'hello', 'habari', 'mambo', 'poa', 'niaje', 'customer', 'unknown',
])

function findName(text: string): string | null {
  // WhatsApp export style: "[10:32, 4/7/2026] Mama Njeri: message" or "Mama Njeri: message"
  const speakers: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(?:\[[^\]]+\]\s*)?([A-Za-z][A-Za-z'’.\- ]{1,30}?):\s/)
    if (m) speakers.push(m[1].trim())
  }
  const candidate = speakers.find((s) => !NOT_A_NAME.has(s.toLowerCase()))
  if (candidate) return candidate

  const from = text.match(/\b(?:from|kwa|to|for|jina)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/)
  if (from && !NOT_A_NAME.has(from[1].toLowerCase())) return from[1]

  const capitalised = text.match(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2})\b/)
  if (capitalised && !NOT_A_NAME.has(capitalised[1].toLowerCase())) return capitalised[1]
  return null
}

const GOODS = /\b(cement|mabati|nails|misumari|paint|rangi|timber|mbao|steel|nondo|pipes|tiles|sand|mchanga|ballast|stock|goods|bidhaa|shoes|viatu|weave|braids|hair|drinks|soda|sukari|unga|maize|flour|bags|order)\b/i

function findDescription(text: string): string {
  const goods = text.match(GOODS)
  const qty = text.match(new RegExp(`\\b(\\d+)\\s*(?:bags?|pieces?|pcs|packets?|cartons?|sacks?|kg)?\\s*(?:of\\s+)?${goods?.[0] ?? '$^'}`, 'i'))
  if (qty) return qty[0].trim()
  if (goods) return `${goods[0]} on credit`
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 8)
  return (firstLine ?? 'Goods on credit').slice(0, 80)
}

export function heuristicExtract(text: string, today: string) {
  const phone = findPhone(text)
  const amount = findAmount(text)
  const name = findName(text)
  const due = findDueDate(text, today)
  const assumptions: string[] = []

  let dueDate = due.date
  if (!dueDate) {
    dueDate = addDays(today, 30)
    assumptions.push('Due date assumed: 30-day default (no date found in the text)')
  }
  if (!phone) assumptions.push('No phone number found — add it before saving')
  if (!amount) assumptions.push('No amount found — add it before saving')
  if (!name) assumptions.push('No customer name found — add it before saving')

  let confidence = 0.35
  if (phone) confidence += 0.2
  if (amount) confidence += 0.2
  if (name) confidence += 0.1
  if (due.explicit) confidence += 0.1

  return {
    customerName: name,
    phone,
    amount,
    dueDate,
    description: findDescription(text),
    confidence: Math.min(confidence, 0.85),
    assumptions,
  }
}

// ---------------------------------------------------------------- reminders

interface RemindInput {
  customerName: string
  balance: number
  daysOverdue: number
  description: string
  tone: string
  language: string
  brokenPromises: number
}

function money(n: number): string {
  return `KES ${new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 }).format(Math.round(n))}`
}

export function heuristicRemind(i: RemindInput): string {
  const name = i.customerName.split(' ')[0]
  const amt = money(i.balance)
  const item = i.description || 'the goods'
  const late = i.daysOverdue
  const broke = i.brokenPromises > 0
  const t = i.tone

  // A debt can be chased before it is overdue (e.g. after a broken promise),
  // so the lateness clause has to degrade gracefully at zero days.
  const when = {
    english: late > 0 ? `${late} day${late === 1 ? '' : 's'} overdue` : 'still outstanding',
    swahili: late > 0 ? `limechelewa kwa siku ${late}` : 'bado halijalipwa',
    sheng: late > 0 ? `ime-delay siku ${late}` : 'bado iko pending',
  }

  if (i.language === 'swahili') {
    if (t === 'friendly') return `Habari ${name}, natumaini u mzima. Ni kumbusho tu kuhusu salio la ${amt} la ${item}. Ukipata nafasi, tafadhali nitumie. Asante sana.`
    if (t === 'professional') return `Habari ${name}. Salio lako la ${amt} la ${item} ${when.swahili}. Tafadhali nijulishe utakapoweza kutuma. Asante.`
    if (t === 'firm') return `Habari ${name}. Deni la ${amt} la ${item} ${when.swahili}.${broke ? ' Tuliahidiana tarehe ambayo haikutimia.' : ''} Tafadhali nipe tarehe kamili utakapolipa ili tumalize jambo hili.`
    return `Habari ${name}. Deni la ${amt} la ${item} ${when.swahili} na ahadi zilizotolewa hazijatimizwa. Tafadhali lipa ili tuendelee. Kwa sasa siwezi kutoa bidhaa nyingine kwa mkopo hadi salio limalizike.`
  }

  if (i.language === 'sheng') {
    if (t === 'friendly') return `Sasa ${name}, niaje. Ni reminder tu ya ile ${amt} ya ${item}. Ukipata chance tuma tu. Asante buda.`
    if (t === 'professional') return `Niaje ${name}. Ile ${amt} ya ${item} ${when.sheng}. Niambie utatuma lini. Asante.`
    if (t === 'firm') return `${name}, ile ${amt} ya ${item} ${when.sheng}.${broke ? ' Ile date tuliagree haikushika.' : ''} Nipe date halisi utalipa tumalizane.`
    return `${name}, ile ${amt} ya ${item} ${when.sheng} na ahadi hazija-shika. Tafadhali clear ile balance. Kwa sasa siwezi kukupatia stock ingine kwa deni mpaka ulipe.`
  }

  if (t === 'friendly') return `Hi ${name}, hope you're well. Just a gentle reminder about the ${amt} balance for ${item}. Whenever you get a chance, please send it through. Thank you.`
  if (t === 'professional') return `Hello ${name}. Your balance of ${amt} for ${item} is ${when.english}. Please let me know when you can send it. Thank you.`
  if (t === 'firm') return `Hello ${name}. The ${amt} for ${item} is ${when.english}.${broke ? ' We agreed on a payment date that has since passed.' : ''} Please give me a firm date for payment so we can close this.`
  return `Hello ${name}. The ${amt} for ${item} is ${when.english} and the payment dates we agreed have passed. Please clear the balance. Until then I am unable to supply anything further on credit.`
}

// ------------------------------------------------------------- reply parsing

export function heuristicParseReply(text: string, today: string) {
  const lower = text.toLowerCase()

  if (/\b(nimelipa|nimetuma|nishatuma|nimeshatuma|i (?:have )?(?:already )?(?:paid|sent)|nilituma|sent already|nimeshalipa)\b/.test(lower)) {
    return { intent: 'paid_claim' as const, promisedDate: null, summary: 'Customer says they have already sent the money — check your M-Pesa messages.' }
  }
  if (/\b(sikununua|sijachukua|si kweli|hiyo si|wrong|dispute|nilishalipa yote|sio yangu|i don'?t owe|not mine|too much|ni ghali)\b/.test(lower)) {
    return { intent: 'dispute' as const, promisedDate: null, summary: 'Customer disputes the debt or the amount — worth a call before the next reminder.' }
  }

  const promising = /\b(nitatuma|nitalipa|nita lipa|nitakutumia|i will (?:send|pay)|i'?ll (?:send|pay)|will pay|nikipata|by then|bila fail|nitamaliza)\b/.test(lower)
  const due = findDueDate(text, today)
  if (promising || due.explicit) {
    return {
      intent: 'promise' as const,
      promisedDate: due.explicit ? due.date : null,
      summary: due.explicit
        ? `Customer promises to pay by ${due.date}.`
        : 'Customer promises to pay but gave no date — ask them to commit to one.',
    }
  }
  return { intent: 'other' as const, promisedDate: null, summary: 'No payment commitment in this reply.' }
}

// ------------------------------------------------------------ mpesa matching

interface OpenDebtRef {
  id: string
  customerName: string
  phone: string
  balance: number
}

/**
 * An M-Pesa SMS quotes two amounts: the one received and the resulting wallet
 * balance. Anchor on the verb so we never bank the balance by mistake.
 */
function mpesaAmount(sms: string): number | null {
  const direct = sms.match(/ksh?s?\.?\s*([\d,]+(?:\.\d+)?)\s+(?:received|sent|paid)/i)
  if (direct) return Math.round(Number(direct[1].replace(/,/g, '')))
  return findAmount(sms.replace(/new\s+m-?pesa\s+balance[^.]*\.?/i, ''))
}

export function heuristicMatchPayment(sms: string, openDebts: OpenDebtRef[]) {
  const ref = sms.match(/\b([A-Z0-9]{10})\b/)?.[1] ?? null
  const amount = mpesaAmount(sms)
  const payer = sms.match(/received from\s+([A-Za-z' ]+?)(?:\s+\d|\s+on\b|,|\.)/i)?.[1]?.trim() ?? null
  const phone = findPhone(sms)

  let debtId: string | null = null
  let reasoning = 'Could not match this payment to an open debt — pick the customer manually.'
  let confidence = 0.3

  if (phone) {
    const hit = openDebts.find((d) => d.phone === phone)
    if (hit) {
      debtId = hit.id
      confidence = 0.95
      reasoning = `Matched by phone number to ${hit.customerName}.`
    }
  }
  if (!debtId && payer) {
    const tokens = payer.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
    const scored = openDebts
      .map((d) => {
        const name = d.customerName.toLowerCase()
        const hits = tokens.filter((t) => name.includes(t)).length
        return { d, hits }
      })
      .filter((s) => s.hits > 0)
      .sort((a, b) => b.hits - a.hits)

    if (scored.length === 1 || (scored.length > 1 && scored[0].hits > scored[1].hits)) {
      debtId = scored[0].d.id
      confidence = 0.8
      reasoning = `Matched by payer name to ${scored[0].d.customerName}.`
    } else if (scored.length > 1) {
      reasoning = 'Several customers share that name — pick the right one manually.'
    }
  }

  return { debtId, amount, mpesaRef: ref, payerName: payer, confidence, reasoning }
}

// -------------------------------------------------------- priority reasoning

interface RankedRef {
  debtId: string
  customerName: string
  balance: number
  daysOverdue: number
  brokenPromises: number
  reliability: string
  tier: string
}

export function heuristicExplain(debts: RankedRef[]) {
  return {
    explanations: debts.map((d) => {
      const parts: string[] = []
      if (d.daysOverdue > 0) parts.push(`${d.daysOverdue} days overdue`)
      else parts.push('not yet due')
      parts.push(`${money(d.balance)} outstanding`)
      if (d.brokenPromises === 1) parts.push('one broken promise')
      if (d.brokenPromises > 1) parts.push(`${d.brokenPromises} broken promises`)
      if (d.reliability === 'risky') parts.push('a customer who pays late')
      if (d.daysOverdue > 60) parts.push('and value is decaying fast')
      return {
        debtId: d.debtId,
        reasoning: parts.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.',
      }
    }),
  }
}

export { daysBetween }
