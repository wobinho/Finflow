/**
 * AuditFlow PDF Parser
 *
 * Handles two kinds of input:
 *   1. Native/text PDFs  — pdfjs-dist extracts positioned text items and uses
 *      column-aware parsing to correctly separate Date / Description / Amount
 *   2. Scanned/image PDFs — pdfjs-dist renders each page to canvas, then
 *      Tesseract.js OCRs the image
 */

import * as pdfjsLib from 'pdfjs-dist'
import { createWorker } from 'tesseract.js'

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// ─── OCR helpers ─────────────────────────────────────────────────────────────

function pageHasText(textContent) {
  return textContent.items.map(i => i.str).join('').trim().length > 40
}

async function renderPageToDataURL(page, scale = 2.5) {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  return canvas.toDataURL('image/png')
}

function cleanOcrLine(line) {
  return line
    .replace(/[|\[\]{}<>]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ─── Native PDF: column-aware extraction ─────────────────────────────────────

/**
 * For a native text PDF we keep the raw positioned items so we can split
 * the page into a left column (date + description) and a right column (amount).
 *
 * Returns: Array of { y, text, x } sorted top-to-bottom (descending y in PDF coords).
 */
function extractPositionedLines(textContent, pageWidth) {
  // Group items by rounded Y
  const lineMap = {}
  for (const item of textContent.items) {
    const y = Math.round(item.transform[5])
    if (!lineMap[y]) lineMap[y] = []
    lineMap[y].push({ x: item.transform[4], text: item.str, w: item.width ?? 0 })
  }

  const sortedYs = Object.keys(lineMap).map(Number).sort((a, b) => b - a)

  return sortedYs.map(y => {
    const items = lineMap[y].sort((a, b) => a.x - b.x)

    // Determine split point: amount column is right-aligned, roughly the
    // rightmost 20 % of the page. Anything starting past that threshold is
    // treated as the amount cell.
    const amountThreshold = pageWidth * 0.78

    const leftItems  = items.filter(it => it.x <  amountThreshold)
    const rightItems = items.filter(it => it.x >= amountThreshold)

    return {
      y,
      left:  leftItems.map(it => it.text).join(' ').trim(),
      right: rightItems.map(it => it.text).join(' ').trim(),
    }
  }).filter(row => row.left || row.right)
}

// ─── Text extraction dispatch ─────────────────────────────────────────────────

async function extractTextFromPDF(pdf) {
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page   = await pdf.getPage(i)
    const tc     = await page.getTextContent()
    const vp     = page.getViewport({ scale: 1 })

    if (pageHasText(tc)) {
      const rows = extractPositionedLines(tc, vp.width)
      pages.push({ pageNum: i, rows, method: 'native' })
    } else {
      const dataURL = await renderPageToDataURL(page)
      pages.push({ pageNum: i, dataURL, method: 'ocr' })
    }
  }
  return pages
}

async function ocrPages(pages, onProgress) {
  const toOcr = pages.filter(p => p.method === 'ocr')
  if (!toOcr.length) return pages

  const worker = await createWorker('eng', 1, {
    cacheMethod: 'none',
    logger: m => {
      if (m.status === 'recognizing text' && onProgress)
        onProgress(m.progress, m.status)
    },
  })

  for (const page of toOcr) {
    const { data } = await worker.recognize(page.dataURL)
    // OCR gives plain lines — convert to the same {left, right} row format
    // using a simple heuristic: last whitespace-separated token that looks
    // like a dollar amount is the right column; everything else is left.
    page.rows = data.text
      .split('\n')
      .map(l => cleanOcrLine(l.trim()))
      .filter(Boolean)
      .map(line => {
        const m = line.match(/^(.*?)\s+(-?[\d,]+\.\d{2})\s*$/)
        if (m) return { left: m[1].trim(), right: m[2].trim() }
        return { left: line, right: '' }
      })
    delete page.dataURL
  }

  await worker.terminate()
  return pages
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

// MM/DD/YY, MM/DD/YYYY, MM-DD-YY, MM-DD-YYYY, YYYY-MM-DD, Mon DD YYYY
const DATE_RE =
  /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$|^\d{4}[\/\-]\d{2}[\/\-]\d{2}$|^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}$/i

// A standalone amount token: optional leading -, digits/commas, mandatory .XX cents
// Also matches amounts without cents (e.g. -5,000 or 2,000)
const AMOUNT_TOKEN_RE = /^-?[\d,]+(\.\d{1,2})?$/

// Lines to always skip
const SKIP_RE =
  /^(balance|beginning balance|ending balance|daily ledger|page \d|account summary|deposits and other credits|withdrawals and other debits|service fees|continued on|total |note your|^\s*date\s)/i

function parseAmount(raw) {
  if (!raw) return null
  const n = parseFloat(raw.replace(/,/g, ''))
  return isNaN(n) ? null : n
}

function parseDateStr(raw) {
  if (!raw) return ''
  try {
    // Handle MM/DD/YY → prepend 20 for the year
    const expanded = raw.replace(
      /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/,
      (_, m, d, y) => `${m}/${d}/20${y}`
    )
    const dt = new Date(expanded)
    if (!isNaN(dt)) {
      const y  = dt.getFullYear()
      const mo = String(dt.getMonth() + 1).padStart(2, '0')
      const da = String(dt.getDate()).padStart(2, '0')
      return `${y}-${mo}-${da}`
    }
  } catch { /* fall through */ }
  return raw
}

function cleanDesc(text) {
  return text
    .replace(/[|\[\]{}<>]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// These continuation suffixes appear as the second line of a multi-line
// transaction in BoA statements — they carry no useful info for the description.
const CONTINUATION_NOISE_RE =
  /^(ID:[A-Z0-9]+\s+(CCD|PPD|WEB)|Confirmation#\s*\d+)$/i

// ─── Main parse: column-aware ─────────────────────────────────────────────────

/**
 * Parse an array of { left, right } rows into transactions.
 *
 * BoA layout (and most structured bank statements) follows:
 *   Row N:   <date>  <description first line>    <amount>
 *   Row N+1:         <description continuation>  (no amount, no date)
 *
 * Strategy:
 *  1. A row is a transaction header if its `left` field starts with a date token.
 *  2. The amount comes from the `right` field of that row.
 *  3. If `right` is empty, scan ahead up to 3 rows for a non-empty `right`.
 *  4. Rows without a leading date that follow a transaction header are treated
 *     as description continuations, unless they look like noise (ID:... CCD).
 */
function parseRows(rows) {
  const transactions = []
  let id = 1
  let i  = 0

  while (i < rows.length) {
    const row = rows[i]

    // Skip blank or header-like rows
    if (SKIP_RE.test(row.left) || SKIP_RE.test(row.right)) { i++; continue }

    // Try to find a date at the start of the left column
    const leftTokens = row.left.split(/\s+/)
    const dateToken  = leftTokens[0]
    if (!DATE_RE.test(dateToken)) { i++; continue }

    const dateStr       = parseDateStr(dateToken)
    const descFirstLine = leftTokens.slice(1).join(' ').trim()

    // Amount: right column of this row, or look ahead a few rows
    let amount    = parseAmount(row.right)
    let amountRowIdx = i

    if (amount === null || amount === 0) {
      for (let j = 1; j <= 3; j++) {
        if (i + j >= rows.length) break
        const candidate = parseAmount(rows[i + j].right)
        if (candidate !== null && candidate !== 0) {
          amount       = candidate
          amountRowIdx = i + j
          break
        }
      }
    }

    if (amount === null) { i++; continue }

    // Collect continuation description lines between current row and amount row
    const descParts = [descFirstLine]
    for (let j = 1; j <= amountRowIdx - i; j++) {
      const cont = rows[i + j].left.trim()
      if (cont && !SKIP_RE.test(cont) && !DATE_RE.test(cont.split(/\s+/)[0]) && !CONTINUATION_NOISE_RE.test(cont)) {
        descParts.push(cont)
      }
    }

    // Also check the row right after the amount row for additional description
    const nextRow = rows[amountRowIdx + 1]
    if (nextRow) {
      const nextLeft = nextRow.left.trim()
      const nextFirstToken = nextLeft.split(/\s+/)[0]
      if (
        nextLeft &&
        !SKIP_RE.test(nextLeft) &&
        !DATE_RE.test(nextFirstToken) &&
        !CONTINUATION_NOISE_RE.test(nextLeft) &&
        !nextRow.right  // no amount = it's a continuation, not a new transaction
      ) {
        descParts.push(nextLeft)
        amountRowIdx++
      }
    }

    const description = cleanDesc(descParts.filter(Boolean).join(' ')) || 'Bank Transaction'
    const type        = amount >= 0 ? 'Deposit' : 'Withdrawal'

    transactions.push({ id: id++, date: dateStr, description, amount, type, category: '' })

    i = amountRowIdx + 1
  }

  return transactions
}

// ─── public API ──────────────────────────────────────────────────────────────

export async function parsePDF(file, onProgress = null) {
  const arrayBuffer = await file.arrayBuffer()

  const pdf       = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pageCount = pdf.numPages

  if (onProgress) onProgress(0.05, 'Loading PDF…')

  let pages = await extractTextFromPDF(pdf)
  const ocrPageCount = pages.filter(p => p.method === 'ocr').length

  if (onProgress) onProgress(0.2, ocrPageCount > 0 ? 'Running OCR on scanned pages…' : 'Parsing text…')

  if (ocrPageCount > 0) {
    pages = await ocrPages(pages, (frac, status) => {
      if (onProgress) onProgress(0.2 + frac * 0.6, status)
    })
  }

  if (onProgress) onProgress(0.85, 'Extracting transactions…')

  const allRows    = pages.flatMap(p => p.rows || [])
  const transactions = parseRows(allRows)

  if (onProgress) onProgress(1, 'Done')

  return { transactions, pageCount, ocrPageCount }
}
