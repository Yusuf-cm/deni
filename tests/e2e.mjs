/**
 * End-to-end check of every Deni feature against a running server.
 *   node tests/e2e.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const SHOTS = new URL('../screens/', import.meta.url).pathname.replace(/^\//, '')
mkdirSync(SHOTS, { recursive: true })

let passed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

// ---------------------------------------------------------------- date helpers
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayISO = iso(new Date())
const endOfMonth = () => {
  const d = new Date()
  return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}
const nextFriday = () => {
  const d = new Date()
  const delta = (5 - d.getDay() + 7) % 7 || 7
  d.setDate(d.getDate() + delta)
  return iso(d)
}

async function api(task, payload) {
  const res = await fetch(`${BASE}/api/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, payload: { today: todayISO, ...payload } }),
  })
  if (!res.ok) throw new Error(`${task} -> HTTP ${res.status}`)
  return res.json()
}

const WHATSAPP = `[09:14] Mama Njeri: Boss niaje, uko na cement ya Bamburi?
[09:15] Me: Niko nayo. Unahitaji ngapi?
[09:16] Mama Njeri: Nipe bags 20. Nitalipa mwisho wa mwezi nikipata pesa ya harambee.
[09:17] Me: Sawa. Bags 20 ni Ksh 16,000.
[09:18] Mama Njeri: Poa boss, nitatuma. Number yangu ni 0722114477.
[09:19] Me: Sawa nimekuandika. Asante.`

const MPESA = `SFJ3K2LM9Q Confirmed. Ksh2,000.00 received from JOHN KAMAU 254712345678 on 26/7/26 at 2:14 PM. New M-PESA balance is Ksh12,430.00.`

// =============================================================== API contract
async function testApi() {
  section('AI API — extraction')
  const ext = await api('extract', { text: WHATSAPP })
  const e = ext.data
  check('extracts customer name', e.customerName === 'Mama Njeri', String(e.customerName))
  check('extracts phone', e.phone === '254722114477', String(e.phone))
  check('extracts amount as integer KES', e.amount === 16000, String(e.amount))
  check('resolves "mwisho wa mwezi" to end of month', e.dueDate === endOfMonth(), String(e.dueDate))
  check('reports a confidence score', typeof e.confidence === 'number' && e.confidence > 0.7, String(e.confidence))
  check('no false assumptions when the date is explicit', e.assumptions.length === 0, JSON.stringify(e.assumptions))

  section('AI API — missing data is flagged, never invented')
  const vague = await api('extract', { text: 'Gave Peter some paint on credit worth Ksh 4,500.' })
  const v = vague.data
  check('applies the 30-day default when no date is stated', v.assumptions.some((a) => /30-day default/i.test(a)), JSON.stringify(v.assumptions))
  check('returns null phone rather than inventing one', v.phone === null, String(v.phone))
  check('drops confidence below the review threshold', v.confidence < 0.7, String(v.confidence))

  section('AI API — reminders')
  for (const language of ['english', 'swahili', 'sheng']) {
    for (const tone of ['friendly', 'professional', 'firm', 'final']) {
      const r = await api('remind', {
        customerName: 'Mama Njeri', balance: 15000, description: 'cement',
        dueDate: todayISO, daysOverdue: 45, brokenPromises: 1, tone, language,
      })
      const msg = r.data.message
      const clean = msg.length > 0 && msg.length < 500
      const hasAmount = /15,?000/.test(msg)
      const noThreat = !/(police|court|auctioneer|jail|sue)/i.test(msg)
      check(`${language}/${tone} reminder is sane`, clean && hasAmount && noThreat, msg.slice(0, 60))
    }
  }
  const zero = await api('remind', {
    customerName: 'John', balance: 8000, description: 'mabati', dueDate: todayISO,
    daysOverdue: 0, brokenPromises: 1, tone: 'firm', language: 'swahili',
  })
  check('no "siku 0" phrasing when not yet overdue', !/siku 0/.test(zero.data.message), zero.data.message)

  section('AI API — reply classification')
  const promise = await api('parse_reply', { replyText: 'Boss nisamehe, nitatuma pesa Friday bila fail.', balance: 15000, description: 'cement' })
  check('detects a promise to pay', promise.data.intent === 'promise', promise.data.intent)
  check('resolves "Friday" to the next Friday', promise.data.promisedDate === nextFriday(), String(promise.data.promisedDate))

  const dispute = await api('parse_reply', { replyText: 'Hiyo si kweli, nilishalipa yote wiki iliyopita.', balance: 15000, description: 'cement' })
  check('detects a dispute', ['dispute', 'paid_claim'].includes(dispute.data.intent), dispute.data.intent)

  const other = await api('parse_reply', { replyText: 'Sawa boss, nimeona ujumbe.', balance: 15000, description: 'cement' })
  check('no promise where none was made', other.data.intent === 'other', other.data.intent)

  section('AI API — M-Pesa matching')
  const open = [
    { id: 'debt-kamau', customerName: 'John Kamau', phone: '254712345678', balance: 8000 },
    { id: 'debt-njeri', customerName: 'Mama Njeri', phone: '254722114477', balance: 15000 },
  ]
  const m = await api('match_payment', { smsText: MPESA, openDebts: open })
  check('parses the M-Pesa amount', m.data.amount === 2000, String(m.data.amount))
  check('parses the transaction reference', m.data.mpesaRef === 'SFJ3K2LM9Q', String(m.data.mpesaRef))
  check('matches the payment to the right debt', m.data.debtId === 'debt-kamau', String(m.data.debtId))

  const unknown = await api('match_payment', {
    smsText: 'QQQ1234567 Confirmed. Ksh500.00 received from JANE DOE 254799000111 on 1/1/26.',
    openDebts: open,
  })
  check('refuses to guess an unmatched payer', unknown.data.debtId === null, String(unknown.data.debtId))

  section('AI API — priority explanations')
  const ex = await api('explain_priority', {
    debts: [{ debtId: 'd1', customerName: 'Mama Njeri', balance: 15000, daysOverdue: 45, brokenPromises: 1, reliability: 'risky', tier: 'high' }],
  })
  check('explains each ranked debt', ex.data.explanations[0]?.debtId === 'd1' && ex.data.explanations[0].reasoning.length > 10, JSON.stringify(ex.data.explanations[0]))

  section('AI API — error handling')
  const bad = await fetch(`${BASE}/api/ai`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'nonsense' }),
  })
  check('rejects an unknown task with 400', bad.status === 400, String(bad.status))
}

// ==================================================================== browser
async function testBrowser() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()

  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  const money = (sel) => page.locator(sel).first().innerText()

  section('Dashboard — empty state and seeding')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  check('empty state invites a first debt', await page.getByText('No debts yet').isVisible())
  await page.getByRole('button', { name: 'Load demo data' }).click()
  await page.getByText('Mama Njeri').first().waitFor()

  const exposure = await money('.tnum')
  check('exposure headline sums open balances', exposure.replace(/\s/g, '').includes('23,000'), exposure)
  check('flags value decaying with age', await page.getByText(/losing value with age/).isVisible())
  await page.screenshot({ path: `${SHOTS}01-dashboard.png` })

  section('Prioritisation')
  const firstCard = page.locator('a[href^="/debt/"]').first()
  check('riskiest debt ranks first', (await firstCard.innerText()).includes('Mama Njeri'), (await firstCard.innerText()).split('\n')[0])
  check('shows a High priority tier', (await firstCard.innerText()).includes('High priority'))
  check('surfaces the broken promise', (await firstCard.innerText()).includes('broken promise'))
  check('shows days overdue', /\d+ days overdue/.test(await firstCard.innerText()))
  check('explains the ranking in words', (await firstCard.innerText()).toLowerCase().includes('outstanding'))

  section('Create a debt from a pasted WhatsApp thread')
  await page.getByRole('link', { name: '+ New debt' }).click()
  await page.getByRole('button', { name: 'Sample' }).click()
  await page.getByRole('button', { name: 'Extract details' }).click()
  await page.getByText('Confirm the details').waitFor()

  const nameField = page.locator('input').first()
  check('customer name pre-filled', (await nameField.inputValue()) === 'Mama Njeri', await nameField.inputValue())
  const amountField = page.locator('input[inputmode="numeric"]').first()
  check('amount pre-filled', (await amountField.inputValue()) === '16000', await amountField.inputValue())
  const dateField = page.locator('input[type="date"]').first()
  check('due date resolved from "mwisho wa mwezi"', (await dateField.inputValue()) === endOfMonth(), await dateField.inputValue())
  check(
    'credit memory warns about the existing debt',
    await page.getByText(/already in your book/).isVisible()
  )
  check('warning names the outstanding amount', (await page.getByText(/Still owes/).innerText()).includes('15,000'))
  await page.screenshot({ path: `${SHOTS}02-extraction.png`, fullPage: true })

  await page.getByRole('button', { name: 'Save debt' }).click()
  await page.waitForURL(/\/debt\//)
  check('lands on the new debt', (await page.locator('h1').innerText()) === 'Mama Njeri')
  check('balance shows the extracted amount', (await money('.tnum')).includes('16,000'), await money('.tnum'))

  section('Tone escalation')
  const toneNotice = await page.getByText(/Suggested tone/).innerText()
  check('tone escalates on the broken promise, not the clock', /firm/i.test(toneNotice), toneNotice)
  check('the reason is visible', /broken promise/i.test(toneNotice), toneNotice)

  section('Reminder generation and WhatsApp hand-off')
  await page.getByRole('button', { name: 'Draft reminder' }).click()
  const messageBox = page.locator('textarea').first()
  await page.waitForFunction(
    () => {
      const t = document.querySelector('textarea')
      return t && t.value.length > 20 && t.value !== 'Writingâ€¦'
    },
    null,
    { timeout: 15000 }
  )
  const swahili = await messageBox.inputValue()
  check('drafts a Kiswahili message by default', /Habari|Tafadhali/.test(swahili), swahili.slice(0, 50))
  check('message states the exact amount', /16,000/.test(swahili), swahili)
  check('message is short enough for WhatsApp', swahili.split(/\s+/).length <= 60, `${swahili.split(/\s+/).length} words`)

  const waHref = await page.locator('a[href^="https://wa.me/"]').getAttribute('href')
  check('wa.me link targets the customer number', waHref.startsWith('https://wa.me/254722114477?text='), waHref?.slice(0, 40))
  check('wa.me link carries the drafted message', decodeURIComponent(waHref.split('?text=')[1]) === swahili)
  await page.screenshot({ path: `${SHOTS}03-reminder.png` })

  await page.getByRole('button', { name: 'Regenerate' }).click()
  await page.waitForTimeout(500)
  const sheng = page.getByRole('button', { name: 'Sheng' })
  await sheng.click()
  await page.waitForFunction(
    () => {
      const t = document.querySelector('textarea')
      return t && /niaje|ile|buda|delay|pending/i.test(t.value)
    },
    null,
    { timeout: 15000 }
  )
  check('switching language regenerates in Sheng', true)

  const [popup] = await Promise.all([
    page.waitForEvent('popup').catch(() => null),
    page.getByRole('button', { name: 'Open WhatsApp' }).click(),
  ])
  if (popup) await popup.close()
  await page.getByText('History').waitFor()
  check(
    'sending records the reminder in the history',
    (await page.getByText('History').locator('..').innerText()).includes('Reminder sent')
  )

  section('Logging a customer reply as a promise')
  await page.getByRole('button', { name: 'Log a reply' }).click()
  await page.getByRole('button', { name: 'Sample' }).click()
  await page.getByRole('button', { name: 'Read reply' }).click()
  await page.getByText('Promise to pay').waitFor()
  const promiseDate = page.locator('input[type="date"]').first()
  check('promise date resolved to the next Friday', (await promiseDate.inputValue()) === nextFriday(), await promiseDate.inputValue())
  await page.getByRole('button', { name: 'Log this promise' }).click()
  await page.getByText('Promised to pay').waitFor()
  check('promise appears in the history', true)
  await page.screenshot({ path: `${SHOTS}04-promise.png`, fullPage: true })

  section('Recording a partial payment from an M-Pesa SMS')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByText('John Kamau').first().click()
  await page.waitForURL(/\/debt\//)
  await page.getByRole('button', { name: 'Record payment' }).click()
  await page.getByRole('button', { name: 'Sample' }).click()
  await page.getByRole('button', { name: 'Read SMS' }).click()
  await page.getByText('SFJ3K2LM9Q', { exact: true }).waitFor()
  const sheetText = await page.getByRole('dialog').innerText()
  const parsedAmount = await page.locator('input[inputmode="numeric"]').first().inputValue()
  check('amount read from the SMS, not the wallet balance', parsedAmount === '2000', parsedAmount)
  check('reference read from the SMS', sheetText.includes('SFJ3K2LM9Q'))
  check('confirms which debt it will be applied to', sheetText.includes('Recording against John Kamau'), sheetText.slice(0, 80))
  await page.getByRole('button', { name: /^Record Ksh/ }).click()
  await page.waitForTimeout(400)
  check('balance drops by the payment', (await money('.tnum')).includes('6,000'), await money('.tnum'))
  check('debt is marked part paid', await page.getByText('Part paid').first().isVisible())
  check('payment appears in the history', (await page.getByText('History').locator('..').innerText()).includes('SFJ3K2LM9Q'))
  await page.screenshot({ path: `${SHOTS}05-payment.png`, fullPage: true })

  section('Clearing a debt in full')
  await page.getByRole('button', { name: 'Record payment' }).click()
  await page.getByRole('button', { name: 'Enter manually' }).click()
  await page.getByRole('button', { name: 'Paid in full' }).click()
  await page.getByRole('button', { name: /^Record Ksh/ }).click()
  await page.waitForTimeout(400)
  check('cleared debt shows a zero balance', (await money('.tnum')).replace(/\s/g, '').includes('0'), await money('.tnum'))
  check('cleared debt is badged', await page.getByText('Cleared').first().isVisible())
  check('actions disappear once cleared', !(await page.getByRole('button', { name: 'Draft reminder' }).isVisible()))

  section('Dashboard reflects the money collected')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  check('collected-this-month is reported', await page.getByText(/recovered/).isVisible())
  check('cleared debt leaves the follow-up queue', !(await page.getByText('John Kamau').isVisible()))
  await page.screenshot({ path: `${SHOTS}06-dashboard-after.png`, fullPage: true })

  section('Persistence and resilience')
  await page.reload({ waitUntil: 'networkidle' })
  check('data survives a reload', await page.getByText('Mama Njeri').first().isVisible())

  await context.route('**/api/ai', (route) => route.abort())
  await page.goto(`${BASE}/new`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Type it in' }).click()
  await page.locator('input').first().fill('Grace Wairimu')
  await page.locator('input[inputmode="tel"]').fill('0712000111')
  await page.locator('input[inputmode="numeric"]').first().fill('2500')
  await page.getByRole('button', { name: 'Save debt' }).click()
  await page.waitForURL(/\/debt\//)
  check('a debt can still be created with the AI unreachable', (await page.locator('h1').innerText()) === 'Grace Wairimu')
  await context.unroute('**/api/ai')

  section('Validation')
  await page.goto(`${BASE}/new`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Type it in' }).click()
  await page.locator('input[inputmode="tel"]').fill('12345')
  await page.getByRole('button', { name: 'Save debt' }).click()
  check('rejects an invalid phone number', await page.getByText(/Not a valid Kenyan number/).isVisible())
  check('will not save without a customer', await page.getByText(/Who owes the money/).isVisible())
  check('stays on the form', page.url().includes('/new'))

  check('no console errors during the whole run', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await browser.close()
}

await testApi()
await testBrowser()

console.log(`\n${'='.repeat(52)}`)
console.log(`${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f}`))
  process.exit(1)
}

