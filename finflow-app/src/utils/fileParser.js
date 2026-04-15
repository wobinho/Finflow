import * as XLSX from 'xlsx'

// Candidate header names for each logical field (case-insensitive)
const FIELD_CANDIDATES = {
  date:        ['date', 'transaction date', 'trans date', 'posted date', 'post date', 'value date'],
  description: ['description', 'desc', 'memo', 'narrative', 'particulars', 'details', 'transaction', 'name', 'payee'],
  amount:      ['amount', 'amt', 'debit/credit', 'transaction amount', 'net amount', 'value'],
  type:        ['type', 'transaction type', 'trans type', 'kind'],
  debit:       ['debit', 'withdrawal', 'withdrawals', 'dr', 'charge', 'charges'],
  credit:      ['credit', 'deposit', 'deposits', 'cr', 'payment', 'payments'],
}

function normalize(s) {
  return String(s ?? '').trim().toLowerCase()
}

/**
 * Detect which column index maps to each logical field.
 * Returns { date, description, amount, type, debit, credit } — each value is a column index or -1.
 */
export function detectColumns(headers) {
  const result = { date: -1, description: -1, amount: -1, type: -1, debit: -1, credit: -1 }
  const norm = headers.map(normalize)

  for (const [field, candidates] of Object.entries(FIELD_CANDIDATES)) {
    for (const candidate of candidates) {
      const idx = norm.findIndex(h => h === candidate || h.includes(candidate))
      if (idx !== -1) {
        result[field] = idx
        break
      }
    }
  }

  return result
}

/**
 * Parse an XLSX or CSV File object.
 * Returns { headers: string[], rows: any[][], mapping: DetectedMapping }
 */
export async function parseFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

  if (raw.length < 2) throw new Error('File appears to be empty or has no data rows.')

  // Find the first row that looks like headers (has at least 2 non-empty string cells)
  let headerRowIdx = 0
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    const stringCells = raw[i].filter(c => typeof c === 'string' && c.trim().length > 0)
    if (stringCells.length >= 2) { headerRowIdx = i; break }
  }

  const headers = raw[headerRowIdx].map(h => String(h ?? '').trim())
  const dataRows = raw.slice(headerRowIdx + 1).filter(row =>
    row.some(cell => cell !== '' && cell !== null && cell !== undefined)
  )

  const mapping = detectColumns(headers)

  return { headers, rows: dataRows, mapping }
}

/**
 * Convert detected rows into the app's transaction format.
 * mapping comes from detectColumns() or user overrides.
 * Returns transaction[] with { id, date, description, type, amount, category }
 */
export function buildTransactions(rows, headers, mapping) {
  const transactions = []
  let id = 1

  for (const row of rows) {
    const get = (idx) => (idx >= 0 ? row[idx] : undefined)

    // ── Date ──────────────────────────────────────────────────────────────────
    let dateStr = ''
    const rawDate = get(mapping.date)
    if (rawDate instanceof Date) {
      dateStr = rawDate.toISOString().slice(0, 10)
    } else if (rawDate) {
      // Try to parse common date string formats
      const parsed = new Date(rawDate)
      if (!isNaN(parsed)) {
        dateStr = parsed.toISOString().slice(0, 10)
      } else {
        dateStr = String(rawDate).trim()
      }
    }

    // ── Description ───────────────────────────────────────────────────────────
    const description = String(get(mapping.description) ?? '').trim()
    if (!description && !dateStr) continue // skip blank rows

    // ── Amount ────────────────────────────────────────────────────────────────
    let amount = 0
    if (mapping.amount >= 0) {
      // Single amount column — may use parentheses or minus for negatives
      const raw = String(get(mapping.amount) ?? '').replace(/[$,\s]/g, '')
      const negative = raw.startsWith('(') || raw.startsWith('-')
      const num = parseFloat(raw.replace(/[()]/g, ''))
      amount = isNaN(num) ? 0 : (negative ? -Math.abs(num) : num)
    } else if (mapping.credit >= 0 || mapping.debit >= 0) {
      // Separate credit / debit columns
      const credit = parseFloat(String(get(mapping.credit) ?? '').replace(/[$,\s]/g, '')) || 0
      const debit  = parseFloat(String(get(mapping.debit)  ?? '').replace(/[$,\s]/g, '')) || 0
      amount = credit - debit
    }

    // ── Type ──────────────────────────────────────────────────────────────────
    let type = String(get(mapping.type) ?? '').trim()
    if (!type) {
      // Infer from amount sign when no type column
      type = amount >= 0 ? 'Deposit' : 'Withdrawal'
    }

    transactions.push({ id: id++, date: dateStr, description, type, amount, category: '' })
  }

  return transactions
}
