import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

function prepareRows(transactions) {
  return transactions.map(tx => ({
    Date: tx.date,
    Description: tx.description,
    Type: tx.type,
    Amount: tx.amount,
    Category: tx.category,
  }))
}

export function exportToCSV(transactions) {
  const rows = prepareRows(transactions)
  const ws = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, 'finflow_transactions.csv')
}

export function exportToXLSX(transactions) {
  const rows = prepareRows(transactions)
  const ws = XLSX.utils.json_to_sheet(rows)

  // Column widths
  ws['!cols'] = [
    { wch: 12 },  // Date
    { wch: 45 },  // Description
    { wch: 12 },  // Type
    { wch: 14 },  // Amount
    { wch: 30 },  // Category
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions')

  // Add a summary sheet
  const summaryData = buildSummary(transactions)
  const wsSummary = XLSX.utils.json_to_sheet(summaryData)
  wsSummary['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 8 }]
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary by Category')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, 'finflow_transactions.xlsx')
}

function buildSummary(transactions) {
  const map = {}
  for (const tx of transactions) {
    if (!map[tx.category]) map[tx.category] = { income: 0, expense: 0, count: 0 }
    if (tx.amount >= 0) map[tx.category].income += tx.amount
    else map[tx.category].expense += Math.abs(tx.amount)
    map[tx.category].count++
  }
  return Object.entries(map)
    .sort(([, a], [, b]) => (b.income + b.expense) - (a.income + a.expense))
    .map(([cat, v]) => ({
      Category: cat,
      Income: v.income,
      Expenses: v.expense,
      Count: v.count,
    }))
}
