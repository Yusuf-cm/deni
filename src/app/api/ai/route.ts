import Anthropic from '@anthropic-ai/sdk'
import { TASKS, type AiTask } from '@/lib/ai/schemas'
import {
  heuristicExplain,
  heuristicExtract,
  heuristicMatchPayment,
  heuristicParseReply,
  heuristicRemind,
} from '@/lib/ai/heuristic'

export const dynamic = 'force-dynamic'

const MODEL = 'claude-sonnet-5'

function hasKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/** The user-turn text for each task. Everything the model may rely on goes here. */
function buildUserMessage(task: AiTask, p: Record<string, unknown>): string {
  const today = String(p.today ?? '')
  switch (task) {
    case 'extract':
      return `Today's date is ${today}.\n\nExtract the debt from this text:\n\n<text>\n${p.text}\n</text>`
    case 'remind':
      return `Write one WhatsApp reminder.\n\nCustomer: ${p.customerName}\nOutstanding balance: KES ${p.balance}\nFor: ${p.description}\nDue date: ${p.dueDate} (${p.daysOverdue} days overdue)\nBroken promises so far: ${p.brokenPromises}\nLanguage: ${p.language}\nTone: ${p.tone}`
    case 'parse_reply':
      return `Today's date is ${today}. The customer owes KES ${p.balance} for ${p.description}.\n\nTheir reply:\n\n<reply>\n${p.replyText}\n</reply>`
    case 'match_payment':
      return `Today's date is ${today}.\n\nM-Pesa SMS:\n\n<sms>\n${p.smsText}\n</sms>\n\nOpen debts:\n${JSON.stringify(p.openDebts, null, 2)}`
    case 'explain_priority':
      return `Explain the ranking of these already-scored debts:\n\n${JSON.stringify(p.debts, null, 2)}`
  }
}

function runHeuristic(task: AiTask, p: Record<string, unknown>): unknown {
  const today = String(p.today ?? '')
  switch (task) {
    case 'extract':
      return heuristicExtract(String(p.text ?? ''), today)
    case 'remind':
      return {
        message: heuristicRemind({
          customerName: String(p.customerName ?? ''),
          balance: Number(p.balance ?? 0),
          daysOverdue: Number(p.daysOverdue ?? 0),
          description: String(p.description ?? ''),
          tone: String(p.tone ?? 'professional'),
          language: String(p.language ?? 'english'),
          brokenPromises: Number(p.brokenPromises ?? 0),
        }),
      }
    case 'parse_reply':
      return heuristicParseReply(String(p.replyText ?? ''), today)
    case 'match_payment':
      return heuristicMatchPayment(
        String(p.smsText ?? ''),
        (p.openDebts as Parameters<typeof heuristicMatchPayment>[1]) ?? []
      )
    case 'explain_priority':
      return heuristicExplain((p.debts as Parameters<typeof heuristicExplain>[0]) ?? [])
  }
}

async function runClaude(task: AiTask, p: Record<string, unknown>): Promise<unknown> {
  const spec = TASKS[task]
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: spec.maxTokens,
    system: spec.system,
    tools: [
      {
        name: spec.toolName,
        description: spec.toolDescription,
        input_schema: spec.schema as Anthropic.Tool['input_schema'],
      },
    ],
    tool_choice: { type: 'tool', name: spec.toolName },
    messages: [{ role: 'user', content: buildUserMessage(task, p) }],
  })

  const block = response.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') throw new Error('Model did not return a tool call')
  return block.input
}

export async function GET() {
  return Response.json({ aiEnabled: hasKey(), model: hasKey() ? MODEL : null })
}

export async function POST(request: Request) {
  let body: { task?: AiTask; payload?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { task, payload = {} } = body
  if (!task || !(task in TASKS)) {
    return Response.json({ error: `Unknown task: ${task}` }, { status: 400 })
  }

  if (!hasKey()) {
    return Response.json({ data: runHeuristic(task, payload), source: 'heuristic' })
  }

  try {
    return Response.json({ data: await runClaude(task, payload), source: 'claude' })
  } catch (error) {
    // Never fail the user's action because the model is unreachable.
    console.error(`[ai:${task}]`, error)
    return Response.json({
      data: runHeuristic(task, payload),
      source: 'heuristic',
      warning: error instanceof Error ? error.message : 'AI request failed',
    })
  }
}
