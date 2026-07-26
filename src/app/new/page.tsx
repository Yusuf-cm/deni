'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Badge, Button, Card, Field, Input, Notice, Segmented, Textarea } from '@/components/ui'
import { CONFIDENCE_THRESHOLD, callAI, type ExtractResult } from '@/lib/ai/client'
import { customerStats, findCustomerByIdentity } from '@/lib/derive'
import { addDays, formatDate, kes, today } from '@/lib/format'
import { displayPhone, normalizePhone } from '@/lib/phone'
import { DEMO_TEXTS } from '@/lib/seed'
import { useDeni } from '@/lib/store'

interface FormState {
  customerName: string
  phone: string
  amount: string
  dueDate: string
  description: string
}

const EMPTY: FormState = {
  customerName: '',
  phone: '',
  amount: '',
  dueDate: '',
  description: '',
}

export default function NewDebtPage() {
  const router = useRouter()
  const { customers, debts, addDebt } = useDeni()

  const [mode, setMode] = useState<'paste' | 'manual'>('paste')
  const [text, setText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [form, setForm] = useState<FormState>(EMPTY)
  const [showForm, setShowForm] = useState(false)
  const [assumptions, setAssumptions] = useState<string[]>([])
  const [confidence, setConfidence] = useState<number | null>(null)
  const [dueDateAssumed, setDueDateAssumed] = useState(false)
  const [touched, setTouched] = useState(false)

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  const normalizedPhone = normalizePhone(form.phone)
  const amountValue = Number(form.amount.replace(/[^\d.]/g, ''))

  const errors = {
    customerName: form.customerName.trim() ? '' : 'Who owes the money?',
    phone: form.phone.trim()
      ? normalizedPhone
        ? ''
        : 'Not a valid Kenyan number (07…, 01… or +254…)'
      : 'Needed to open WhatsApp',
    amount: amountValue > 0 ? '' : 'Enter the amount owed',
    dueDate: form.dueDate ? '' : 'Pick a due date',
  }
  const valid = Object.values(errors).every((e) => !e)

  // Credit memory: does this person already owe us, and how have they behaved?
  const history = useMemo(() => {
    const match = findCustomerByIdentity(customers, form.customerName, normalizedPhone)
    if (!match) return null
    const stats = customerStats(match.id, debts)
    if (stats.openDebts === 0 && stats.paidDebts === 0) return null
    return { customer: match, stats }
  }, [customers, debts, form.customerName, normalizedPhone])

  async function runExtraction() {
    if (!text.trim()) return
    setExtracting(true)
    setExtractError('')
    try {
      const { data } = await callAI<ExtractResult>('extract', { text })
      setForm({
        customerName: data.customerName ?? '',
        phone: data.phone ?? '',
        amount: data.amount ? String(data.amount) : '',
        dueDate: data.dueDate ?? addDays(today(), 30),
        description: data.description ?? '',
      })
      setAssumptions(data.assumptions ?? [])
      setConfidence(data.confidence ?? null)
      setDueDateAssumed((data.assumptions ?? []).some((a) => /due date/i.test(a)))
      setShowForm(true)
      setTouched(true)
    } catch (e) {
      setExtractError(
        e instanceof Error ? e.message : 'Could not read that text. Enter the details manually.'
      )
    } finally {
      setExtracting(false)
    }
  }

  function save() {
    setTouched(true)
    if (!valid || !normalizedPhone) return
    const debt = addDebt({
      customerName: form.customerName.trim(),
      phone: normalizedPhone,
      principal: Math.round(amountValue),
      description: form.description.trim() || 'Goods on credit',
      dueDate: form.dueDate,
      dueDateAssumed,
    })
    router.push(`/debt/${debt.id}`)
  }

  const lowConfidence = confidence !== null && confidence < CONFIDENCE_THRESHOLD

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-lg text-slate-600"
          aria-label="Back to dashboard"
        >
          ←
        </Link>
        <h1 className="text-xl font-black tracking-tight text-slate-900">New debt</h1>
      </header>

      <Segmented
        value={mode}
        onChange={(m) => {
          setMode(m)
          if (m === 'manual') {
            setShowForm(true)
            setConfidence(null)
            setAssumptions([])
            setDueDateAssumed(false)
            if (!form.dueDate) set({ dueDate: addDays(today(), 30) })
          }
        }}
        options={[
          { value: 'paste', label: 'Paste text' },
          { value: 'manual', label: 'Type it in' },
        ]}
      />

      {mode === 'paste' && (
        <Card className="space-y-3">
          <Field
            label="Paste the WhatsApp chat, invoice or note"
            hint="Claude pulls out the customer, amount and due date. You confirm before it saves."
          >
            <Textarea
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Mama Njeri: Nipe bags 20 za cement, nitalipa mwisho wa mwezi…"
            />
          </Field>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={runExtraction} loading={extracting} disabled={!text.trim()}>
              {extracting ? 'Reading…' : 'Extract details'}
            </Button>
            <Button variant="secondary" onClick={() => setText(DEMO_TEXTS.whatsapp)}>
              Sample
            </Button>
          </div>
          {extractError && <Notice tone="red">{extractError}</Notice>}
        </Card>
      )}

      {showForm && (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Confirm the details</h2>
            {confidence !== null && (
              <Badge tone={lowConfidence ? 'amber' : 'green'}>
                {Math.round(confidence * 100)}% sure
              </Badge>
            )}
          </div>

          {lowConfidence && (
            <Notice tone="amber" title="Please check this carefully">
              Some details were unclear in the text. Fill in anything missing before saving.
            </Notice>
          )}

          {assumptions.length > 0 && (
            <ul className="space-y-1.5">
              {assumptions.map((a) => (
                <li
                  key={a}
                  className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
                >
                  Assumed: {a}
                </li>
              ))}
            </ul>
          )}

          {history && (
            <Notice
              tone={history.stats.reliability === 'good' ? 'blue' : 'red'}
              title={`${history.customer.name} is already in your book`}
            >
              {history.stats.openDebts > 0 ? (
                <>
                  Still owes <strong className="tnum">{kes(history.stats.totalOwed)}</strong> across{' '}
                  {history.stats.openDebts} debt{history.stats.openDebts === 1 ? '' : 's'}
                  {history.stats.brokenPromises > 0 && (
                    <>
                      , and has broken {history.stats.brokenPromises} payment promise
                      {history.stats.brokenPromises === 1 ? '' : 's'}
                    </>
                  )}
                  .{' '}
                  {history.stats.reliability === 'risky' && (
                    <strong>Consider cash only until this is cleared.</strong>
                  )}
                </>
              ) : (
                <>
                  Has cleared {history.stats.paidDebts} debt
                  {history.stats.paidDebts === 1 ? '' : 's'} with you
                  {history.stats.avgDaysLate !== null && history.stats.avgDaysLate > 0 && (
                    <>, paying {history.stats.avgDaysLate} days late on average</>
                  )}
                  .
                </>
              )}
            </Notice>
          )}

          <Field label="Customer name" error={touched ? errors.customerName : ''}>
            <Input
              value={form.customerName}
              onChange={(e) => set({ customerName: e.target.value })}
              placeholder="Mama Njeri"
            />
          </Field>

          <Field
            label="Phone number"
            error={touched ? errors.phone : ''}
            hint={normalizedPhone ? `Will send to ${displayPhone(normalizedPhone)}` : undefined}
          >
            <Input
              inputMode="tel"
              value={form.phone}
              onChange={(e) => set({ phone: e.target.value })}
              placeholder="0722 114 477"
            />
          </Field>

          <Field label="Amount owed (KES)" error={touched ? errors.amount : ''}>
            <Input
              inputMode="numeric"
              value={form.amount}
              onChange={(e) => set({ amount: e.target.value })}
              placeholder="16000"
            />
          </Field>

          <Field
            label="Due date"
            error={touched ? errors.dueDate : ''}
            hint={
              form.dueDate
                ? `${formatDate(form.dueDate)}${dueDateAssumed ? ' — assumed, not stated in the text' : ''}`
                : undefined
            }
          >
            <Input
              type="date"
              value={form.dueDate}
              onChange={(e) => {
                set({ dueDate: e.target.value })
                setDueDateAssumed(false)
              }}
            />
          </Field>

          <Field label="What was sold">
            <Input
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="20 bags of cement"
            />
          </Field>

          <Button className="w-full" onClick={save} disabled={touched && !valid}>
            Save debt
          </Button>
        </Card>
      )}
    </div>
  )
}
