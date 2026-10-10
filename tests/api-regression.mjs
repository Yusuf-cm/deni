import assert from 'node:assert/strict'
const base = process.argv[2] ?? 'http://127.0.0.1:3100'
const state = await fetch(`${base}/api/ai`).then(r => r.json())
assert.equal(state.aiEnabled, false, 'Run with no AI credentials: deterministic fallback only')
async function call(task, payload) {
  const r = await fetch(`${base}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, payload: { today: '2026-10-10', ...payload } }) })
  assert.equal(r.status, 200)
  const result = await r.json()
  assert.equal(result.source, 'heuristic')
  return result.data
}
const extracted = await call('extract', { text: 'Sample Customer: KES 1500 for cement. Phone 0700000000. Due 15 October 2026.' })
assert.equal(extracted.amount, 1500)
assert.equal(extracted.phone, '254700000000')
assert.equal(extracted.dueDate, '2026-10-15')
const missing = await call('extract', { text: 'Gave Peter some paint on credit worth Ksh 4500.' })
assert.equal(missing.phone, null)
assert.equal(missing.dueDate, '2026-11-09')
assert.ok(missing.assumptions.length > 0)
for (const [text, intent, date] of [['I will pay on 15 October 2026', 'promise', '2026-10-15'], ['I already paid', 'paid_claim', null], ["I don’t owe you".replace('’', "'"), 'dispute', null], ['Thanks', 'other', null]]) {
  const result = await call('parse_reply', { replyText: text })
  assert.equal(result.intent, intent)
  assert.equal(result.promisedDate, date)
}
const payment = await call('match_payment', { smsText: 'TEST123456 Confirmed. Ksh250.00 received from SAMPLE CUSTOMER 254700000000 on 10/10/26. New M-PESA balance is Ksh12,430.00.', openDebts: [{ id: 'sample', customerName: 'Sample Customer', phone: '254700000000', balance: 1500 }] })
assert.equal(payment.amount, 250)
assert.equal(payment.debtId, 'sample')
const invalid = await fetch(`${base}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'invalid' }) })
assert.equal(invalid.status, 400)
console.log('API regression checks passed: extraction, missing-data fallback, four reply intents, payment matching and unknown-task handling')
