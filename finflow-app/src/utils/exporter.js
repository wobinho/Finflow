import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

function prepareRows(transactions, includeCategory = true) {
  return transactions.map(tx => {
    const row = {
      Date: tx.date,
      Description: tx.description,
      Type: tx.type,
      Amount: tx.amount,
    }
    if (includeCategory) row.Category = tx.category
    return row
  })
}

export function exportToCSV(transactions) {
  const rows = prepareRows(transactions)
  const ws = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, 'finflow_transactions.csv')
}

export function exportToCSVNoCategory(transactions) {
  const rows = prepareRows(transactions, false)
  const ws = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, 'finflow_transactions_no_category.csv')
}

export function exportToXLSX(transactions) {
  const rows = prepareRows(transactions)
  const ws = XLSX.utils.json_to_sheet(rows)

  ws['!cols'] = [
    { wch: 12 },
    { wch: 45 },
    { wch: 12 },
    { wch: 14 },
    { wch: 30 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions')

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

export function exportToXLSXNoCategory(transactions) {
  const rows = prepareRows(transactions, false)
  const ws = XLSX.utils.json_to_sheet(rows)

  ws['!cols'] = [
    { wch: 12 },
    { wch: 45 },
    { wch: 12 },
    { wch: 14 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  saveAs(blob, 'finflow_transactions_no_category.xlsx')
}

export function exportToQBO(transactions) {
  const lines = [
    '!TRNS\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO',
    '!SPL\tDATE\tACCNT\tAMOUNT\tMEMO',
    '!ENDTRNS',
  ]
  for (const tx of transactions) {
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
  saveAs(blob, 'finflow_transactions.iif')
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
