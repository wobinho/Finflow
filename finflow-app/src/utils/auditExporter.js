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

function toQBRow(tx, includeCategory = true) {
  const row = {
    Date: tx.date,
    Description: tx.description,
    Amount: tx.amount,
    Type: tx.type,
  }
  if (includeCategory) row.Category = tx.category || ''
  return row
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

function buildTransactionSheet(transactions, includeCategory = true) {
  const rows = transactions.map(tx => toQBRow(tx, includeCategory))
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = includeCategory
    ? [{ wch: 12 }, { wch: 50 }, { wch: 14 }, { wch: 14 }, { wch: 32 }]
    : [{ wch: 12 }, { wch: 50 }, { wch: 14 }, { wch: 14 }]
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

export function auditExportToCSV(transactions, sortMode = 'original', baseName = 'auditflow') {
  const sorted = sortTransactions(transactions, sortMode)
  const rows = sorted.map(tx => toQBRow(tx, true))
  const ws = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, `${baseName}_quickbooks.csv`)
}

export function auditExportToCSVNoCategory(transactions, sortMode = 'original', baseName = 'auditflow') {
  const sorted = sortTransactions(transactions, sortMode)
  const rows = sorted.map(tx => toQBRow(tx, false))
  const ws = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, `${baseName}_no_category.csv`)
}

export function auditExportToXLSX(transactions, sortMode = 'original', baseName = 'auditflow') {
  const sorted = sortTransactions(transactions, sortMode)
  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(wb, buildTransactionSheet(sorted, true), 'Transactions')
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(sorted), 'Summary')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, `${baseName}_quickbooks.xlsx`)
}

export function auditExportToXLSXNoCategory(transactions, sortMode = 'original', baseName = 'auditflow') {
  const sorted = sortTransactions(transactions, sortMode)
  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(wb, buildTransactionSheet(sorted, false), 'Transactions')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, `${baseName}_no_category.xlsx`)
}

export function auditExportToQBO(transactions, sortMode = 'original', baseName = 'auditflow') {
  const sorted = sortTransactions(transactions, sortMode)
  const lines = [
    '!TRNS\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO',
    '!SPL\tDATE\tACCNT\tAMOUNT\tMEMO',
    '!ENDTRNS',
  ]
  for (const tx of sorted) {
    const date = tx.date.replace(/-/g, '/')
    const acct = tx.amount >= 0 ? 'Income' : 'Expenses'
    const amount = Number(tx.amount).toFixed(2)
    const splitAmount = (-tx.amount).toFixed(2)
    const memo = tx.description.replace(/\t/g, ' ')
    lines.push(`TRNS\t${date}\t${acct}\t${memo}\t${amount}\t${memo}`)
    lines.push(`SPL\t${date}\tUncategorized\t${splitAmount}\t${memo}`)
    lines.push('ENDTRNS')
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' })
  saveAs(blob, `${baseName}.iif`)
}
