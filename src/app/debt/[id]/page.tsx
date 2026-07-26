'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Notice,
  Segmented,
  Select,
  Sheet,
  Spinner,
  Textarea,
} from '@/components/ui'
import { callAI, type MatchResult, type ReplyResult } from '@/lib/ai/client'
import { customerStats, daysOverdue, resolvePromises, totalPaid } from '@/lib/derive'
import { formatDate, kes, relativeDue, today } from '@/lib/format'
import { displayPhone, waLink } from '@/lib/phone'
import { DEMO_TEXTS } from '@/lib/seed'
import { useDeni } from '@/lib/store'
import { LANGUAGES, suggestedTone, TONES, toneReason } from '@/lib/tone'
import type { Language, Tone } from '@/lib/types'

export default function DebtDetailPage() {
  const params = useParams<{ id: string }>()
  const { ready, debts, customers, addPayment, addPromise, addReminder } = useDeni()

  const [sheet, setSheet] = useState<'remind' | 'reply' | 'pay' | null>(null)

  const raw = debts.find((d) => d.id === params.id)
  const debt = raw ? resolvePromises(raw) : undefined
  const customer = customers.find((c) => c.id === debt?.customerId)
  const stats = useMemo(
    () => (debt ? customerStats(debt.customerId, debts) : null),
    [debt, debts]
  )

  if (!ready) {
    return (
      <div className="flex justify-center py-24 text-slate-400">
        <Spinner />
      </div>
    )
  }

  if (!debt || !customer || !stats) {
    return (
      <Card className="space-y-3 text-center">
        <p className="font-bold text-slate-900">That debt is no longer here</p>
        <Link href="/" className="block">
          <Button variant="secondary" className="w-full">
            Back to dashboard
          </Button>
        </Link>
      </Card>
    )
  }

  const late = daysOverdue(debt)
  const paid = totalPaid(debt)
  const tone = suggestedTone(late, stats.brokenPromises)

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
        <div className="min-w-0">
          <h1 className="truncate text-xl font-black tracking-tight text-slate-900">
            {customer.name}
          </h1>
          <p className="text-sm text-slate-500">{displayPhone(customer.phone)}</p>
        </div>
      </header>

      <Card className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Outstanding
          </p>
          <p className="tnum text-4xl font-black tracking-tight text-slate-900">
            {kes(debt.balance)}
          </p>
          {paid > 0 && (
            <p className="tnum mt-1 text-sm text-slate-500">
              {kes(paid)} paid of {kes(debt.principal)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge tone={debt.status === 'paid' ? 'green' : late > 30 ? 'red' : late > 0 ? 'amber' : 'blue'}>
            {debt.status === 'paid' ? 'Cleared' : relativeDue(debt.dueDate)}
          </Badge>
          {debt.status === 'partial' && <Badge tone="blue">Part paid</Badge>}
          {stats.reliability === 'risky' && <Badge tone="red">Risky payer</Badge>}
          {stats.reliability === 'watch' && <Badge tone="amber">Watch</Badge>}
          {stats.reliability === 'good' && <Badge tone="green">Reliable</Badge>}
        </div>

        <dl className="grid grid-cols-2 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
          <dt className="text-slate-500">For</dt>
          <dd className="text-right font-medium text-slate-900">{debt.description}</dd>
          <dt className="text-slate-500">Given on</dt>
          <dd className="text-right font-medium text-slate-900">{formatDate(debt.createdAt)}</dd>
          <dt className="text-slate-500">Due</dt>
          <dd className="text-right font-medium text-slate-900">
            {formatDate(debt.dueDate)}
            {debt.dueDateAssumed && (
              <span className="ml-1 text-xs font-semibold text-amber-700">assumed</span>
            )}
          </dd>
        </dl>
      </Card>

      {debt.status !== 'paid' && (
        <div className="grid grid-cols-2 gap-2">
          <Button className="col-span-2" onClick={() => setSheet('remind')}>
            Draft reminder
          </Button>
          <Button variant="secondary" onClick={() => setSheet('reply')}>
            Log a reply
          </Button>
          <Button variant="secondary" onClick={() => setSheet('pay')}>
            Record payment
          </Button>
        </div>
      )}

      {debt.status !== 'paid' && (
        <Notice tone={late > 14 ? 'red' : 'blue'}>
          Suggested tone: <strong className="capitalize">{tone}</strong> —{' '}
          {toneReason(late, stats.brokenPromises)}.
        </Notice>
      )}

      <Timeline debt={debt} />

      {sheet === 'remind' && (
        <RemindSheet
          onClose={() => setSheet(null)}
          debtId={debt.id}
          customerName={customer.name}
          phone={customer.phone}
          balance={debt.balance}
          description={debt.description}
          dueDate={debt.dueDate}
          daysOverdue={late}
          brokenPromises={stats.brokenPromises}
          defaultTone={tone}
          onSent={(r) => {
            addReminder(debt.id, r)
            setSheet(null)
          }}
        />
      )}

      {sheet === 'reply' && (
        <ReplySheet
          onClose={() => setSheet(null)}
          balance={debt.balance}
          description={debt.description}
          onPromise={(date) => {
            addPromise(debt.id, date)
            setSheet(null)
          }}
        />
      )}

      {sheet === 'pay' && (
        <PaymentSheet
          onClose={() => setSheet(null)}
          balance={debt.balance}
          customerName={customer.name}
          phone={customer.phone}
          debtId={debt.id}
          onPay={(p) => {
            addPayment(debt.id, p)
            setSheet(null)
          }}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ timeline

function Timeline({ debt }: { debt: ReturnType<typeof resolvePromises> }) {
  const entries = [
    {
      date: debt.createdAt,
      title: 'Debt recorded',
      body: `${kes(debt.principal)} for ${debt.description}`,
      tone: 'neutral' as const,
    },
    ...debt.reminders.map((r) => ({
      date: r.sentAt,
      title: `Reminder sent · ${r.tone}`,
      body: r.text,
      tone: 'blue' as const,
    })),
    ...debt.promises.map((p) => ({
      date: p.madeAt,
      title:
        p.status === 'kept'
          ? 'Promise kept'
          : p.status === 'broken'
            ? 'Promise broken'
            : 'Promised to pay',
      body: `Said they would pay by ${formatDate(p.promisedDate)}`,
      tone: p.status === 'broken' ? ('red' as const) : ('green' as const),
    })),
    ...debt.payments.map((p) => ({
      date: p.date,
      title: `Payment received · ${kes(p.amount)}`,
      body: p.mpesaRef ? `M-Pesa ${p.mpesaRef}` : (p.note ?? 'Recorded manually'),
      tone: 'green' as const,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  const DOT = {
    neutral: 'bg-slate-300',
    blue: 'bg-sky-500',
    green: 'bg-emerald-500',
    red: 'bg-red-500',
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">History</h2>
      <ol className="space-y-3">
        {entries.map((e, i) => (
          <li key={`${e.date}-${i}`} className="flex gap-3">
            <div className="flex flex-col items-center pt-1.5">
              <span className={`size-2.5 shrink-0 rounded-full ${DOT[e.tone]}`} />
              {i < entries.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-bold text-slate-900">{e.title}</p>
                <p className="shrink-0 text-xs text-slate-400">{formatDate(e.date)}</p>
              </div>
              <p className="mt-0.5 text-sm leading-snug text-slate-600">{e.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

// ------------------------------------------------------------ reminder sheet

function RemindSheet({
  onClose,
  customerName,
  phone,
  balance,
  description,
  dueDate,
  daysOverdue: late,
  brokenPromises,
  defaultTone,
  onSent,
}: {
  onClose: () => void
  debtId: string
  customerName: string
  phone: string
  balance: number
  description: string
  dueDate: string
  daysOverdue: number
  brokenPromises: number
  defaultTone: Tone
  onSent: (r: { tone: Tone; language: Language; text: string }) => void
}) {
  const [tone, setTone] = useState<Tone>(defaultTone)
  const [language, setLanguage] = useState<Language>('swahili')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const generate = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await callAI<{ message: string }>('remind', {
        customerName,
        balance,
        description,
        dueDate,
        daysOverdue: late,
        brokenPromises,
        tone,
        language,
      })
      setMessage(data.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft a message. Type one yourself.')
    } finally {
      setLoading(false)
    }
  }, [customerName, balance, description, dueDate, late, brokenPromises, tone, language])

  useEffect(() => {
    generate()
  }, [generate])

  return (
    <Sheet open onClose={onClose} title="Draft reminder">
      <div className="space-y-4">
        <Segmented value={language} onChange={setLanguage} options={LANGUAGES} />

        <Field label="Tone">
          <Select value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
            {TONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
                {t.value === defaultTone ? ' (suggested)' : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Message" hint="Edit it freely — this is what WhatsApp will open with.">
          <Textarea
            rows={6}
            value={loading ? 'Writing…' : message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={loading}
          />
        </Field>

        {error && <Notice tone="red">{error}</Notice>}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={generate} loading={loading}>
            Regenerate
          </Button>
          <a
            className="flex-1"
            href={waLink(phone, message)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onSent({ tone, language, text: message })}
          >
            <Button className="w-full" disabled={!message || loading}>
              Open WhatsApp
            </Button>
          </a>
        </div>
        <p className="text-center text-xs text-slate-400">
          WhatsApp opens with the message filled in — you still tap send there.
        </p>
      </div>
    </Sheet>
  )
}

// --------------------------------------------------------------- reply sheet

function ReplySheet({
  onClose,
  balance,
  description,
  onPromise,
}: {
  onClose: () => void
  balance: number
  description: string
  onPromise: (date: string) => void
}) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ReplyResult | null>(null)
  const [date, setDate] = useState('')
  const [error, setError] = useState('')

  async function analyse() {
    setLoading(true)
    setError('')
    try {
      const { data } = await callAI<ReplyResult>('parse_reply', {
        replyText: text,
        balance,
        description,
      })
      setResult(data)
      setDate(data.promisedDate ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that reply.')
    } finally {
      setLoading(false)
    }
  }

  const INTENT_LABEL: Record<ReplyResult['intent'], string> = {
    promise: 'Promise to pay',
    paid_claim: 'Says they already paid',
    dispute: 'Disputes the debt',
    other: 'No commitment',
  }

  return (
    <Sheet open onClose={onClose} title="Log a reply">
      <div className="space-y-4">
        <Field label="Paste what the customer said">
          <Textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Boss nisamehe, nitatuma pesa Friday bila fail."
          />
        </Field>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={analyse} loading={loading} disabled={!text.trim()}>
            Read reply
          </Button>
          <Button variant="secondary" onClick={() => setText(DEMO_TEXTS.reply)}>
            Sample
          </Button>
        </div>

        {error && <Notice tone="red">{error}</Notice>}

        {result && (
          <div className="space-y-3">
            <Notice tone={result.intent === 'promise' ? 'blue' : 'amber'} title={INTENT_LABEL[result.intent]}>
              {result.summary}
            </Notice>

            {result.intent === 'promise' && (
              <>
                <Field
                  label="Promised payment date"
                  hint="If they miss this date, the next reminder escalates automatically."
                >
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Button className="w-full" disabled={!date} onClick={() => onPromise(date)}>
                  Log this promise
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}

// ------------------------------------------------------------- payment sheet

function PaymentSheet({
  onClose,
  balance,
  customerName,
  phone,
  debtId,
  onPay,
}: {
  onClose: () => void
  balance: number
  customerName: string
  phone: string
  debtId: string
  onPay: (p: {
    amount: number
    date: string
    source: 'manual' | 'mpesa'
    mpesaRef?: string
    note?: string
  }) => void
}) {
  const [mode, setMode] = useState<'mpesa' | 'manual'>('mpesa')
  const [sms, setSms] = useState('')
  const [loading, setLoading] = useState(false)
  const [parsed, setParsed] = useState<MatchResult | null>(null)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  async function readSms() {
    setLoading(true)
    setError('')
    try {
      const { data } = await callAI<MatchResult>('match_payment', {
        smsText: sms,
        openDebts: [{ id: debtId, customerName, phone, balance }],
      })
      setParsed(data)
      if (data.amount) setAmount(String(data.amount))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that SMS.')
    } finally {
      setLoading(false)
    }
  }

  const value = Number(amount.replace(/[^\d.]/g, ''))
  const overpay = value > balance

  // The SMS names a payer; warn if it doesn't look like this debt's customer.
  const payerMismatch = Boolean(
    parsed?.payerName &&
      !parsed.payerName
        .toLowerCase()
        .split(/\s+/)
        .some((t) => t.length > 2 && customerName.toLowerCase().includes(t))
  )

  function submit() {
    if (!(value > 0)) return
    onPay({
      amount: value,
      date,
      source: mode,
      mpesaRef: parsed?.mpesaRef ?? undefined,
      note: note.trim() || undefined,
    })
  }

  return (
    <Sheet open onClose={onClose} title="Record payment">
      <div className="space-y-4">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'mpesa', label: 'Paste M-Pesa SMS' },
            { value: 'manual', label: 'Enter manually' },
          ]}
        />

        {mode === 'mpesa' && (
          <>
            <Field label="Paste the confirmation message">
              <Textarea
                rows={4}
                value={sms}
                onChange={(e) => setSms(e.target.value)}
                placeholder="SFJ3K2LM9Q Confirmed. Ksh2,000.00 received from…"
              />
            </Field>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={readSms} loading={loading} disabled={!sms.trim()}>
                Read SMS
              </Button>
              <Button variant="secondary" onClick={() => setSms(DEMO_TEXTS.mpesaSms)}>
                Sample
              </Button>
            </div>
            {parsed &&
              (parsed.amount ? (
                <Notice tone={payerMismatch ? 'amber' : 'green'}>
                  Read <strong className="tnum">{kes(parsed.amount)}</strong>
                  {parsed.mpesaRef && (
                    <>
                      , reference <strong>{parsed.mpesaRef}</strong>
                    </>
                  )}
                  . Recording against {customerName}.
                  {payerMismatch && (
                    <>
                      {' '}
                      <strong>
                        But the SMS says it came from {parsed.payerName} — check this is the right
                        debt.
                      </strong>
                    </>
                  )}
                </Notice>
              ) : (
                <Notice tone="amber">
                  Could not read an amount from that message — enter it below.
                </Notice>
              ))}
          </>
        )}

        {error && <Notice tone="red">{error}</Notice>}

        <Field
          label="Amount received (KES)"
          hint={`Outstanding balance is ${kes(balance)}`}
          error={overpay ? `More than the balance — only ${kes(balance)} will be applied` : ''}
        >
          <Input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="2000"
          />
        </Field>

        <Field label="Date received">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        {mode === 'manual' && (
          <Field label="Note (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Cash at the shop" />
          </Field>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setAmount(String(balance))}>
            Paid in full
          </Button>
          <Button className="flex-1" onClick={submit} disabled={!(value > 0)}>
            Record {value > 0 ? kes(Math.min(value, balance)) : 'payment'}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
