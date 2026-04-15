/**
 * AuditFlow Exporter
 *
 * Exports transactions extracted from a PDF bank statement into a
 * QuickBooks-ready CSV or XLSX file.
 *
 * QuickBooks Online import expects these columns (at minimum):
 *   Date | Description | Amount | Type (optional) | Account (optional)
 *
 * Sort modes:
 *   'original'  — preserve the order they appeared in the PDF
 *   'date'      — ascending by date
 *   'category'  — alphabetical by category, then by date within each group
 */

import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

// ─── column definitions ──────────────────────────────────────────────────────

/** Maps our internal transaction fields to QuickBooks-friendly column names. */
function toQBRow(tx) {
  return {
    Date: tx.date,
    Description: tx.description,
    Amount: tx.amount,
    Type: tx.type,
    Category: tx.category || '',
  }
}

// ─── sorting ─────────────────────────────────────────────────────────────────

function sortTransactions(transactions, mode) {
  const copy = [...transactions]
  if (mode === 'date') {
    copy.sort((a, b) => {
      const da = new Date(a.date), db = new Date(b.date)
      return da - db
    })
  } else if (mode === 'category') {
    copy.sort((a, b) => {
      const ca = (a.category || 'Uncategorized').toLowerCase()
      const cb = (b.category || 'Uncategorized').toLowerCase()
      if (ca < cb) return -1
      if (ca > cb) return 1
      return new Date(a.date) - new Date(b.date)
    })
  }
  // 'original' — no sort, return as-is
  return copy
}

// ─── XLSX helpers ────────────────────────────────────────────────────────────

function buildTransactionSheet(transactions) {
  const rows = transactions.map(toQBRow)
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 12 },  // Date
    { wch: 50 },  // Description
    { wch: 14 },  // Amount
    { wch: 14 },  // Type
    { wch: 32 },  // Category
  ]
  return ws
}

function buildSummarySheet(transactions) {
  const map = {}
  for (const tx of transactions) {
    const key = tx.category || 'Uncategorized'
    if (!map[key]) map[key] = { income: 0, expense: 0, count: 0 }
    if (tx.amount >= 0) map[key].income += tx.amount
    else map[key].expense += Math.abs(tx.amount)
    map[key].count++
  }

  const summaryRows = Object.entries(map)
    .sort(([, a], [, b]) => (b.income + b.expense) - (a.income + a.expense))
    .map(([cat, v]) => ({
      Category: cat,
      'Total Income': Number(v.income.toFixed(2)),
      'Total Expenses': Number(v.expense.toFixed(2)),
      'Net': Number((v.income - v.expense).toFixed(2)),
      'Transactions': v.count,
    }))

  // Totals row
  const totalIncome  = transactions.reduce((s, tx) => tx.amount > 0 ? s + tx.amount : s, 0)
  const totalExpense = transactions.reduce((s, tx) => tx.amount < 0 ? s + Math.abs(tx.amount) : s, 0)
  summaryRows.push({
    Category: 'TOTAL',
    'Total Income': Number(totalIncome.toFixed(2)),
    'Total Expenses': Number(totalExpense.toFixed(2)),
    'Net': Number((totalIncome - totalExpense).toFixed(2)),
    'Transactions': transactions.length,
  })

  const ws = XLSX.utils.json_to_sheet(summaryRows)
  ws['!cols'] = [{ wch: 32 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }]
  return ws
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * @param {Array}  transactions - Parsed & categorized transactions
 * @param {'original'|'date'|'category'} sortMode
 * @param {string} baseName     - Used for the filename (e.g. "statement_jan")
 */
export function auditExportToCSV(transactions, sortMode = 'original', baseName = 'auditflow') {
  const sorted = sortTransactions(transactions, sortMode)
  const rows = sorted.map(toQBRow)
  const ws = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, `${baseName}_quickbooks.csv`)
}

export function auditExportToXLSX(transactions, sortMode = 'original', baseName = 'auditflow') {
  const sorted = sortTransactions(transactions, sortMode)
  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(wb, buildTransactionSheet(sorted), 'Transactions')
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(sorted), 'Summary')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, `${baseName}_quickbooks.xlsx`)
}
