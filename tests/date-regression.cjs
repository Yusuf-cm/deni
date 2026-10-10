/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS regression runner loads temporary CommonJS compiler output. */
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const output = mkdtempSync(join(tmpdir(), 'deni-dates-'))
try {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', 'src/lib/ai/heuristic.ts', '--outDir', output, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'], { stdio: 'inherit' })
  const { heuristicParseReply, heuristicExtract, heuristicRemind } = require(join(output, 'ai/heuristic.js'))
  const today = '2026-10-10'
  const cases = [
    ['I will pay 2000 on 15 October 2026.', '2026-10-15'],
    ['I will pay on 15th Oct 2026', '2026-10-15'],
    ['I will pay on 2026-10-15', '2026-10-15'],
    ['I will pay on 15/10/26', '2026-10-15'],
    ['I will pay tomorrow', '2026-10-11'],
    ['Nitalipa kesho', '2026-10-11'],
    ['I will pay on 31 February 2026', null],
    ['I will pay on 31/02/2026', null],
    ['I will pay on 2026-02-31', null],
    ['I will pay on 29 February 2028', '2028-02-29'],
  ]
  for (const [text, expected] of cases) {
    assert.equal(heuristicParseReply(text, today).promisedDate, expected, text)
  }
  assert.equal(heuristicExtract('Mama Njeri: KES 1000 due 15 October 2026', today).dueDate, '2026-10-15')
  const input = { customerName: 'Sample', balance: 750, daysOverdue: 0, description: 'sample goods', tone: 'friendly', brokenPromises: 0 }
  assert.match(heuristicRemind({ ...input, language: 'english' }), /^Hi Sample/)
  assert.match(heuristicRemind({ ...input, language: 'swahili' }), /^Habari Sample/)
  assert.match(heuristicRemind({ ...input, language: 'sheng' }), /^Sasa Sample/)
  console.log('14 date and language regression checks passed')
} finally {
  rmSync(output, { recursive: true, force: true })
}
