'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Card, Notice, Spinner } from '@/components/ui'
import { callAI, type ExplainResult } from '@/lib/ai/client'
import { daysOverdue } from '@/lib/derive'
import { kes, parseISO, relativeDue, today } from '@/lib/format'
import { rankDebts, valueAtRisk } from '@/lib/priority'
import { buildSeed } from '@/lib/seed'
import { useDeni } from '@/lib/store'
import type { ScoredDebt, Tier } from '@/lib/types'

const TIER_TONE = { high: 'red', medium: 'amber', low: 'neutral' } as const
const TIER_LABEL: Record<Tier, string> = { high: 'High', medium: 'Medium', low: 'Low' }

export default function DashboardPage() {
  const { ready, debts, customers, replaceAll } = useDeni()
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null)
  const explainedFor = useRef<string>('')

  const ranked = useMemo(
    () => (ready ? rankDebts(debts, customers) : []),
    [ready, debts, customers]
  )

  const totals = useMemo(() => {
    const now = today()
    const open = debts.filter((d) => d.status !== 'paid')
    const month = now.slice(0, 7)
    return {
      outstanding: open.reduce((s, d) => s + d.balance, 0),
      atRisk: Math.round(open.reduce((s, d) => s + valueAtRisk(d, now), 0)),
      customersOwing: new Set(open.map((d) => d.customerId)).size,
      overdue: open.filter((d) => daysOverdue(d, now) > 0).length,
      dueToday: open.filter((d) => d.dueDate === now).length,
      collectedThisMonth: debts
        .flatMap((d) => d.payments)
        .filter((p) => p.date.startsWith(month))
        .reduce((s, p) => s + p.amount, 0),
    }
  }, [debts])

  useEffect(() => {
    fetch('/api/ai')
      .then((r) => r.json())
      .then((d) => setAiEnabled(Boolean(d.aiEnabled)))
      .catch(() => setAiEnabled(false))
  }, [])

  // One explanation pass per distinct set of top debts.
  useEffect(() => {
    const top = ranked.slice(0, 5)
    if (!top.length) return
    const key = top.map((r) => `${r.debt.id}:${r.debt.balance}:${r.daysOverdue}`).join('|')
    if (explainedFor.current === key) return
    explainedFor.current = key

    callAI<ExplainResult>('explain_priority', {
      debts: top.map((r) => ({
        debtId: r.debt.id,
        customerName: r.customer.name,
        balance: r.debt.balance,
        daysOverdue: r.daysOverdue,
        brokenPromises: r.stats.brokenPromises,
        reliability: r.stats.reliability,
        tier: r.tier,
      })),
    })
      .then(({ data }) => {
        setExplanations((prev) => ({
          ...prev,
          ...Object.fromEntries(data.explanations.map((e) => [e.debtId, e.reasoning])),
        }))
      })
      .catch(() => {
        /* The ranking still stands without prose; nothing to recover. */
      })
  }, [ranked])

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Deni</h1>
          <p className="text-sm text-slate-500">Your collections desk</p>
        </div>
        {aiEnabled === false && <Badge tone="neutral">Offline rules</Badge>}
      </header>

      <Card className="border-emerald-900 bg-emerald-800 text-white">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100">
          Locked in deni
        </p>
        <p className="tnum mt-1 text-4xl font-black tracking-tight">{kes(totals.outstanding)}</p>
        <p className="mt-1.5 text-sm text-emerald-100">
          {totals.atRisk > 0 ? (
            <>
              <span className="tnum font-bold text-amber-200">{kes(totals.atRisk)}</span> of it is
              losing value with age
            </>
          ) : (
            'Nothing has aged into the danger zone yet'
          )}
        </p>

        <dl className="mt-4 grid grid-cols-4 gap-2 border-t border-emerald-700 pt-3 text-center">
          <Stat label="Owing" value={totals.customersOwing} />
          <Stat label="Overdue" value={totals.overdue} />
          <Stat label="Due today" value={totals.dueToday} />
          <Stat label="Collected" value={kes(totals.collectedThisMonth)} small />
        </dl>
      </Card>

      {ranked.length === 0 ? (
        <Card className="space-y-4 text-center">
          <div>
            <p className="text-base font-bold text-slate-900">No debts yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Add one from a WhatsApp thread, or load the demo shop to look around.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Link href="/new" className="block">
              <Button className="w-full">Add a debt</Button>
            </Link>
            <Button variant="secondary" onClick={() => replaceAll(buildSeed())}>
              Load demo data
            </Button>
          </div>
        </Card>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Follow up today
            </h2>
            <span className="text-sm text-slate-400">{ranked.length} open</span>
          </div>
          {ranked.map((r) => (
            <DebtRow key={r.debt.id} scored={r} explanation={explanations[r.debt.id]} />
          ))}
        </section>
      )}

      {ranked.length > 0 && totals.collectedThisMonth > 0 && (
        <Notice tone="green">
          You&apos;ve recovered <strong className="tnum">{kes(totals.collectedThisMonth)}</strong>{' '}
          this month.
        </Notice>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-[var(--page)] via-[var(--page)] to-transparent pb-5 pt-8">
        <div className="mx-auto w-full max-w-[480px] px-4">
          <Link href="/new" className="block">
            <Button className="w-full shadow-lg shadow-emerald-900/15">+ New debt</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div>
      <dd className={`tnum font-bold ${small ? 'text-sm' : 'text-lg'}`}>{value}</dd>
      <dt className="text-[11px] font-medium text-emerald-100">{label}</dt>
    </div>
  )
}

function DebtRow({ scored, explanation }: { scored: ScoredDebt; explanation?: string }) {
  const { debt, customer, tier, daysOverdue: late, stats } = scored
  const lastReminder = debt.reminders.at(-1)

  return (
    <Link href={`/debt/${debt.id}`} className="block">
      <Card className="transition-colors active:bg-slate-50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-slate-900">{customer.name}</p>
            <p className="truncate text-sm text-slate-500">{debt.description}</p>
          </div>
          <p className="tnum shrink-0 text-lg font-black text-slate-900">{kes(debt.balance)}</p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge tone={TIER_TONE[tier]}>{TIER_LABEL[tier]} priority</Badge>
          <Badge tone={late > 0 ? (late > 30 ? 'red' : 'amber') : 'green'}>
            {relativeDue(debt.dueDate)}
          </Badge>
          {stats.brokenPromises > 0 && (
            <Badge tone="red">
              {stats.brokenPromises} broken promise{stats.brokenPromises === 1 ? '' : 's'}
            </Badge>
          )}
          {debt.status === 'partial' && <Badge tone="blue">Part paid</Badge>}
          {stats.reliability === 'risky' && <Badge tone="red">Risky payer</Badge>}
        </div>

        {explanation && (
          <p className="mt-3 border-l-2 border-emerald-600 pl-2.5 text-sm leading-snug text-slate-600">
            {explanation}
          </p>
        )}

        {lastReminder && (
          <p className="mt-2.5 text-xs text-slate-400">
            Last reminder{' '}
            {parseISO(lastReminder.sentAt).toLocaleDateString('en-KE', {
              day: 'numeric',
              month: 'short',
            })}{' '}
            · {lastReminder.tone}
          </p>
        )}
      </Card>
    </Link>
  )
}
