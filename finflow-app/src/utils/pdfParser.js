/**
 * AuditFlow PDF Parser
 *
 * Handles two kinds of input:
 *   1. Native/text PDFs  — pdfjs-dist extracts the text directly
 *   2. Scanned/image PDFs — pdfjs-dist renders each page to a canvas,
 *      then Tesseract.js OCRs the image
 *
 * Returns an array of raw transaction objects:
 *   { date, description, amount, type }
 */

import * as pdfjsLib from 'pdfjs-dist'
import { createWorker } from 'tesseract.js'

// Point pdfjs at its worker (Vite serves node_modules as static assets via ?url)
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// ─── helpers ────────────────────────────────────────────────────────────────

/** Returns true if a page has meaningful selectable text. */
function pageHasText(textContent) {
  const combined = textContent.items.map(i => i.str).join('').trim()
  return combined.length > 40
}

/** Render a PDF page to an off-screen canvas and return its ImageData URL. */
async function renderPageToDataURL(page, scale = 2.5) {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/png')
}

// ─── text extraction ─────────────────────────────────────────────────────────

async function extractTextFromPDF(pdf) {
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()

    if (pageHasText(textContent)) {
      // Native text page — join items preserving rough line breaks
      const lineMap = {}
      for (const item of textContent.items) {
        const y = Math.round(item.transform[5])
        if (!lineMap[y]) lineMap[y] = []
        lineMap[y].push(item.str)
      }
      const sortedYs = Object.keys(lineMap).map(Number).sort((a, b) => b - a)
      const lines = sortedYs.map(y => lineMap[y].join(' ').trim()).filter(Boolean)
      pages.push({ pageNum: i, lines, method: 'native' })
    } else {
      // Scanned page — OCR via Tesseract
      const dataURL = await renderPageToDataURL(page)
      pages.push({ pageNum: i, dataURL, method: 'ocr' })
    }
  }
  return pages
}

/**
 * Strip OCR artefacts introduced by table borders and scan noise.
 * Common culprits: | [ ] { } that Tesseract reads as cell dividers.
 */
function cleanOcrLine(line) {
  return line
    // Remove table-border characters that OCR picks up as cell separators
    .replace(/[|\[\]{}<>]/g, ' ')
    // Collapse multiple spaces back to one
    .replace(/\s{2,}/g, ' ')
    .trim()
}

async function ocrPages(pages, onProgress) {
  const ocrPages = pages.filter(p => p.method === 'ocr')
  if (ocrPages.length === 0) return pages

  const worker = await createWorker('eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress, m.status)
      }
    },
  })

  for (const page of ocrPages) {
    const { data } = await worker.recognize(page.dataURL)
    page.lines = data.text
      .split('\n')
      .map(l => cleanOcrLine(l.trim()))
      .filter(Boolean)
    delete page.dataURL
  }

  await worker.terminate()
  return pages
}

// ─── transaction parsing ─────────────────────────────────────────────────────

/**
 * Date patterns commonly found in bank statements.
 * Captures:  MM/DD/YYYY  MM-DD-YYYY  Mon DD YYYY  Mon DD, YYYY
 *            MM/DD/YY  YYYY-MM-DD
 */
const DATE_RE =
  /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i

/**
 * Amount patterns: optional leading $ or -, trailing CR/DR indicator
 * Examples:  1,234.56   -$1,234.56   1,234.56 CR
 */
const AMOUNT_RE =
  /(-?\$?[\d,]{1,3}(?:,\d{3})*(?:\.\d{2})?)(?:\s*(CR|DR|cr|dr))?/

/** Lines that are almost certainly headers or noise */
const SKIP_RE =
  /balance|beginning|ending|page \d|statement|account number|routing|available|^\s*date\s+desc/i

function parseAmount(raw, indicator) {
  if (!raw) return null
  const cleaned = raw.replace(/[$,]/g, '')
  let val = parseFloat(cleaned)
  if (isNaN(val)) return null
  // CR = credit/deposit (positive), DR = debit/expense (negative)
  if (indicator) {
    const ind = indicator.toUpperCase()
    if (ind === 'DR') val = -Math.abs(val)
    if (ind === 'CR') val = Math.abs(val)
  }
  return val
}

function parseDateStr(raw) {
  if (!raw) return ''
  // Normalize separators and try to produce YYYY-MM-DD
  try {
    const d = new Date(raw.replace(/-/g, '/'))
    if (!isNaN(d)) {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }
  } catch {
    // fall through
  }
  return raw
}

/**
 * Given an array of text lines, attempt to extract transactions.
 *
 * Strategy:
 *   - Look for lines that contain a date + an amount
 *   - Treat the text between date and amount as the description
 *   - If a line has a date but no amount, look ahead up to 2 lines
 */
function parseLines(lines) {
  const transactions = []
  let id = 1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Skip obvious header/noise lines
    if (SKIP_RE.test(line)) continue

    const dateMatch = line.match(DATE_RE)
    if (!dateMatch) continue

    const dateStr = parseDateStr(dateMatch[0])
    const afterDate = line.slice(dateMatch.index + dateMatch[0].length).trim()

    // Try to find an amount in the remainder of this line, or next 2 lines
    let amountMatch = afterDate.match(AMOUNT_RE)
    let description = ''
    let amountLine = afterDate

    if (!amountMatch || Math.abs(parseAmount(amountMatch[1])) === 0) {
      // Look ahead
      let combined = afterDate
      for (let j = 1; j <= 2 && i + j < lines.length; j++) {
        combined += ' ' + lines[i + j]
        amountMatch = combined.match(AMOUNT_RE)
        if (amountMatch && Math.abs(parseAmount(amountMatch[1])) !== 0) {
          amountLine = combined
          break
        }
      }
    }

    if (!amountMatch) continue
    const amount = parseAmount(amountMatch[1], amountMatch[2])
    if (amount === null || amount === 0) continue

    // Description = everything between date and amount; strip leftover border chars
    const amountIdx = amountLine.indexOf(amountMatch[0])
    description = amountLine.slice(0, amountIdx)
      .replace(/[|\[\]{}<>]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (!description) description = 'Bank Transaction'

    // Infer type from amount sign
    const type = amount >= 0 ? 'Deposit' : 'Withdrawal'

    transactions.push({
      id: id++,
      date: dateStr,
      description,
      amount,
      type,
      category: '',
    })
  }

  return transactions
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Main entry point.
 *
 * @param {File}     file        - A PDF File object from the browser
 * @param {Function} onProgress  - Optional callback(fraction 0–1, statusLabel)
 * @returns {Promise<{transactions: Array, pageCount: number, ocrPageCount: number}>}
 */
export async function parsePDF(file, onProgress = null) {
  const arrayBuffer = await file.arrayBuffer()

  // Load PDF
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise
  const pageCount = pdf.numPages

  if (onProgress) onProgress(0.05, 'Loading PDF…')

  // Extract text (native + flagging scanned pages)
  let pages = await extractTextFromPDF(pdf)
  const ocrPageCount = pages.filter(p => p.method === 'ocr').length

  if (onProgress) onProgress(0.2, ocrPageCount > 0 ? 'Running OCR on scanned pages…' : 'Parsing text…')

  // OCR scanned pages if needed
  if (ocrPageCount > 0) {
    pages = await ocrPages(pages, (frac, status) => {
      if (onProgress) onProgress(0.2 + frac * 0.6, status)
    })
  }

  if (onProgress) onProgress(0.85, 'Extracting transactions…')

  // Collect all lines in page order
  const allLines = pages.flatMap(p => p.lines || [])

  // Parse transactions
  const transactions = parseLines(allLines)

  if (onProgress) onProgress(1, 'Done')

  return { transactions, pageCount, ocrPageCount }
}
