import { useState, useRef, useCallback, useMemo } from 'react'
import { parsePDF } from '../utils/pdfParser'
import { autoCategorizeAll, CATEGORIES } from '../data/categorizer'
import { auditExportToCSV, auditExportToCSVNoCategory, auditExportToXLSX, auditExportToXLSXNoCategory, auditExportToQBO } from '../utils/auditExporter'
import './AuditFlow.css'

const fmt = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let _nextId = 100000  // counter for manually-added rows (avoids colliding with parsed ids)
function nextId() { return ++_nextId }

function applySortMode(rows, mode) {
  const copy = [...rows]
  if (mode === 'date') {
    copy.sort((a, b) => new Date(a.date) - new Date(b.date))
  } else if (mode === 'category') {
    copy.sort((a, b) => {
      const ca = (a.category || 'Uncategorized').toLowerCase()
      const cb = (b.category || 'Uncategorized').toLowerCase()
      if (ca < cb) return -1
      if (ca > cb) return 1
      return new Date(a.date) - new Date(b.date)
    })
  }
  return copy
}

function blankRow() {
  return {
    id: nextId(),
    date: '',
    description: '',
    type: 'Deposit',
    amount: 0,
    category: 'Uncategorized',
  }
}

// ─── Editable cell ────────────────────────────────────────────────────────────
function EditableCell({ value, onChange, type = 'text', className = '' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')
  const inputRef = useRef(null)

  function startEdit() {
    setDraft(String(value ?? ''))
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function commit() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed === String(value ?? '')) return
    if (type === 'number') {
      const n = parseFloat(trimmed.replace(/[^0-9.\-]/g, ''))
      if (!isNaN(n)) onChange(n)
    } else {
      onChange(trimmed)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter')  { e.preventDefault(); commit() }
    if (e.key === 'Escape') { setEditing(false) }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`af-inline-input ${className}`}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    )
  }

  return (
    <span className={`af-editable ${className}`} onClick={startEdit} title="Click to edit">
      {value}
    </span>
  )
}

// ─── Type select cell ─────────────────────────────────────────────────────────
function TypeCell({ value, onChange }) {
  return (
    <select className="af-type-select" value={value} onChange={e => onChange(e.target.value)}>
      <option value="Deposit">Deposit</option>
      <option value="Withdrawal">Withdrawal</option>
      <option value="Check">Check</option>
      <option value="Fee">Fee</option>
      <option value="Transfer">Transfer</option>
    </select>
  )
}

// ─── Category select + add-new ────────────────────────────────────────────────
function CategoryCell({ value, categories, onChange, onAddCategory }) {
  const [addingNew, setAddingNew] = useState(false)
  const [newCat, setNewCat]       = useState('')
  const newInputRef = useRef(null)

  function startAdd() {
    setAddingNew(true)
    setNewCat('')
    setTimeout(() => newInputRef.current?.focus(), 0)
  }

  function commitNew() {
    const trimmed = newCat.trim()
    if (trimmed) { onAddCategory(trimmed); onChange(trimmed) }
    setAddingNew(false)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter')  { e.preventDefault(); commitNew() }
    if (e.key === 'Escape') { setAddingNew(false) }
  }

  if (addingNew) {
    return (
      <div className="af-cat-new-wrap">
        <input
          ref={newInputRef}
          className="af-inline-input"
          placeholder="New category…"
          value={newCat}
          onChange={e => setNewCat(e.target.value)}
          onBlur={commitNew}
          onKeyDown={onKeyDown}
        />
      </div>
    )
  }

  return (
    <div className="af-cat-cell">
      <select
        className="af-cat-select"
        value={categories.includes(value) ? value : ''}
        onChange={e => {
          if (e.target.value === '__add__') startAdd()
          else onChange(e.target.value)
        }}
      >
        {!categories.includes(value) && (
          <option value="">{value || 'Uncategorized'}</option>
        )}
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
        <option value="__add__">+ Add new category…</option>
      </select>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AuditFlow({
  stage, setStage,
  transactions, setTransactions,
  fileName, setFileName,
  pageCount, setPageCount,
  ocrPageCount, setOcrPageCount,
  customCategories, setCustomCategories,
  sortMode, setSortMode,
  search, setSearch,
  filterType, setFilterType,
}) {
  const inputRef = useRef(null)
  const [dragging, setDragging]           = useState(false)
  const [progress, setProgress]           = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [error, setError]                 = useState('')

  // Row selection — Set of tx ids
  const [selected, setSelected] = useState(new Set())

  const allCategories = useMemo(
    () => [...CATEGORIES, ...customCategories.filter(c => !CATEGORIES.includes(c))],
    [customCategories]
  )

  // ── file handling ─────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file) return
    if (file.name.split('.').pop().toLowerCase() !== 'pdf') {
      setError('Please upload a PDF file (native or scanned).')
      return
    }
    setError('')
    setStage('loading')
    setProgress(0)
    setProgressLabel('Starting…')

    try {
      const { transactions: raw, pageCount: pc, ocrPageCount: ocr } =
        await parsePDF(file, (frac, label) => {
          setProgress(Math.round(frac * 100))
          setProgressLabel(label)
        })

      if (raw.length === 0) {
        setError(
          'No transactions could be extracted. Make sure this is a bank statement PDF.' +
          (ocr > 0 ? ' OCR was used — check that the scan is clear.' : '')
        )
        setStage('idle')
        return
      }

      setTransactions(autoCategorizeAll(raw))
      setFileName(file.name)
      setPageCount(pc)
      setOcrPageCount(ocr)
      setSelected(new Set())
      setStage('review')
    } catch (e) {
      console.error(e)
      setError(e.message || 'Failed to process PDF.')
      setStage('idle')
    }
  }, [setStage, setTransactions, setFileName, setPageCount, setOcrPageCount])

  const onDragOver  = (e) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = ()  => setDragging(false)
  const onDrop      = (e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }

  // ── edits ─────────────────────────────────────────────────────────────────
  const patchTx = useCallback((id, patch) => {
    setTransactions(prev => prev.map(tx => tx.id === id ? { ...tx, ...patch } : tx))
  }, [setTransactions])

  const handleAddCategory = useCallback((name) => {
    setCustomCategories(prev => prev.includes(name) ? prev : [...prev, name])
  }, [setCustomCategories])

  // ── add row ───────────────────────────────────────────────────────────────
  const handleAddRow = useCallback(() => {
    const row = blankRow()
    setTransactions(prev => [...prev, row])
    // Scroll to bottom happens naturally; briefly highlight the new row
    setSelected(new Set([row.id]))
  }, [setTransactions])

  // ── selection helpers ─────────────────────────────────────────────────────
  const toggleRow = useCallback((id, e) => {
    // Prevent toggling when the click was on an interactive cell element
    if (e.target.closest('input, select')) return
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback((displayedIds) => {
    setSelected(prev => {
      const allSelected = displayedIds.every(id => prev.has(id))
      if (allSelected) {
        // deselect all displayed
        const next = new Set(prev)
        displayedIds.forEach(id => next.delete(id))
        return next
      } else {
        // select all displayed
        const next = new Set(prev)
        displayedIds.forEach(id => next.add(id))
        return next
      }
    })
  }, [])

  // ── delete selected ───────────────────────────────────────────────────────
  const handleDeleteSelected = useCallback(() => {
    setTransactions(prev => prev.filter(tx => !selected.has(tx.id)))
    setSelected(new Set())
  }, [selected, setTransactions])

  const handleReset = useCallback(() => {
    setStage('idle'); setTransactions([]); setFileName('')
    setPageCount(0); setOcrPageCount(0)
    setSearch(''); setFilterType('All'); setSortMode('original')
    setSelected(new Set())
  }, [setStage, setTransactions, setFileName, setPageCount, setOcrPageCount, setSearch, setFilterType, setSortMode])

  // ── derived display list ──────────────────────────────────────────────────
  const displayed = useMemo(() => {
    let rows = transactions
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(
        tx => tx.description.toLowerCase().includes(q) ||
              tx.category.toLowerCase().includes(q) ||
              tx.date.toLowerCase().includes(q)
      )
    }
    if (filterType !== 'All') rows = rows.filter(tx => tx.type === filterType)
    return applySortMode(rows, sortMode)
  }, [transactions, search, filterType, sortMode])

  const displayedIds = useMemo(() => displayed.map(tx => tx.id), [displayed])
  const allDisplayedSelected = displayedIds.length > 0 && displayedIds.every(id => selected.has(id))
  const someDisplayedSelected = displayedIds.some(id => selected.has(id))

  const totalIncome  = transactions.reduce((s, tx) => tx.amount > 0 ? s + tx.amount           : s, 0)
  const totalExpense = transactions.reduce((s, tx) => tx.amount < 0 ? s + Math.abs(tx.amount) : s, 0)
  const net          = totalIncome - totalExpense

  // ── IDLE ──────────────────────────────────────────────────────────────────
  if (stage === 'idle') {
    return (
      <div className="af-screen">
        <div className="af-card">
          <div className="af-logo">⬡</div>
          <h1 className="af-title">AuditFlow</h1>
          <p className="af-subtitle">PDF Bank Statement → QuickBooks CSV / XLSX</p>

          <div
            className={`af-drop-zone ${dragging ? 'drag-over' : ''}`}
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input ref={inputRef} type="file" accept=".pdf" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])} />
            <div className="af-drop-icon">↑</div>
            <p className="af-drop-primary">Drop your bank statement PDF here</p>
            <p className="af-drop-secondary">or <span className="af-drop-link">click to browse</span></p>
            <p className="af-drop-formats">PDF &nbsp;·&nbsp; Native &nbsp;·&nbsp; Scanned (OCR)</p>
          </div>

          {error && <p className="af-error">{error}</p>}

          <div className="af-hints">
            <p className="af-hints-title">Supported formats</p>
            <ul className="af-hints-list">
              <li><strong>Native PDF</strong> — digital statements from your bank's portal</li>
              <li><strong>Scanned PDF</strong> — scanned paper statements (OCR applied automatically)</li>
            </ul>
            <p className="af-hints-title" style={{ marginTop: 12 }}>Output</p>
            <ul className="af-hints-list">
              <li>QuickBooks-ready <strong>CSV</strong> or <strong>XLSX</strong></li>
              <li>Sort by <strong>Date</strong>, <strong>Category</strong>, or <strong>Original</strong> order</li>
              <li>Fully editable — click cells, select rows to delete, add new rows</li>
            </ul>
          </div>
        </div>
      </div>
    )
  }

  // ── LOADING ───────────────────────────────────────────────────────────────
  if (stage === 'loading') {
    return (
      <div className="af-screen">
        <div className="af-card af-loading-card">
          <div className="af-logo">⬡</div>
          <h2 className="af-loading-title">Processing PDF…</h2>
          <p className="af-loading-label">{progressLabel}</p>
          <div className="af-progress-track">
            <div className="af-progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <p className="af-progress-pct">{progress}%</p>
          {ocrPageCount > 0 && (
            <p className="af-ocr-note">
              OCR detected — running Tesseract on {ocrPageCount} scanned page{ocrPageCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── REVIEW ────────────────────────────────────────────────────────────────
  return (
    <div className="af-review">

      {/* Stats bar */}
      <div className="af-stats-bar">
        <div className="af-stat">
          <span className="af-stat-label">File</span>
          <span className="af-stat-val af-stat-file">{fileName}</span>
        </div>
        <div className="af-stat-sep" />
        <div className="af-stat">
          <span className="af-stat-label">Pages</span>
          <span className="af-stat-val">{pageCount}{ocrPageCount > 0 ? ` (${ocrPageCount} OCR)` : ''}</span>
        </div>
        <div className="af-stat-sep" />
        <div className="af-stat">
          <span className="af-stat-label">Transactions</span>
          <span className="af-stat-val">{transactions.length}</span>
        </div>
        <div className="af-stat-sep" />
        <div className="af-stat">
          <span className="af-stat-label">Income</span>
          <span className="af-stat-val af-income">${fmt(totalIncome)}</span>
        </div>
        <div className="af-stat-sep" />
        <div className="af-stat">
          <span className="af-stat-label">Expenses</span>
          <span className="af-stat-val af-expense">${fmt(totalExpense)}</span>
        </div>
        <div className="af-stat-sep" />
        <div className="af-stat">
          <span className="af-stat-label">Net</span>
          <span className={`af-stat-val ${net >= 0 ? 'af-income' : 'af-expense'}`}>${fmt(net)}</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="af-toolbar">
        <div className="af-toolbar-left">
          <input className="af-search" type="text" placeholder="Search transactions…"
            value={search} onChange={e => setSearch(e.target.value)} />
          <select className="af-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="All">All types</option>
            <option value="Deposit">Deposits</option>
            <option value="Withdrawal">Withdrawals</option>
            <option value="Check">Checks</option>
            <option value="Fee">Fees</option>
            <option value="Transfer">Transfers</option>
          </select>
        </div>

        <div className="af-toolbar-center">
          <span className="af-sort-label">Sort by:</span>
          {[
            { key: 'original', label: 'Original order' },
            { key: 'date',     label: 'Date' },
            { key: 'category', label: 'Category' },
          ].map(({ key, label }) => (
            <button key={key}
              className={`af-sort-btn ${sortMode === key ? 'active' : ''}`}
              onClick={() => setSortMode(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="af-toolbar-right">
          <span className="af-count">
            {displayed.length !== transactions.length
              ? `${displayed.length} of ${transactions.length}`
              : `${transactions.length} transactions`}
          </span>

          {/* Selection actions — only shown when something is selected */}
          {selected.size > 0 && (
            <button className="af-btn af-btn-delete" onClick={handleDeleteSelected}>
              ✕ Delete {selected.size} row{selected.size !== 1 ? 's' : ''}
            </button>
          )}

          <button className="af-btn af-btn-add" onClick={handleAddRow}>
            + Add row
          </button>

          <button className="af-btn af-btn-csv"
            onClick={() => auditExportToCSV(transactions, sortMode, fileName.replace('.pdf', ''))}
            title="CSV with category">
            ↓ CSV
          </button>
          <button className="af-btn af-btn-csv"
            onClick={() => auditExportToCSVNoCategory(transactions, sortMode, fileName.replace('.pdf', ''))}
            title="CSV without category">
            ↓ CSV (no cat.)
          </button>
          <button className="af-btn af-btn-xlsx"
            onClick={() => auditExportToXLSX(transactions, sortMode, fileName.replace('.pdf', ''))}
            title="XLSX with category">
            ↓ XLSX
          </button>
          <button className="af-btn af-btn-xlsx"
            onClick={() => auditExportToXLSXNoCategory(transactions, sortMode, fileName.replace('.pdf', ''))}
            title="XLSX without category">
            ↓ XLSX (no cat.)
          </button>
          <button className="af-btn af-btn-qbo"
            onClick={() => auditExportToQBO(transactions, sortMode, fileName.replace('.pdf', ''))}
            title="QuickBooks IIF format">
            ↓ QBO
          </button>
          <button className="af-btn af-btn-reset" onClick={handleReset}>
            ↑ New PDF
          </button>
        </div>
      </div>

      {/* Edit hint */}
      <div className="af-edit-hint">
        ✎ Click any <strong>Date</strong>, <strong>Description</strong>, or <strong>Amount</strong> to edit inline.&nbsp;&nbsp;
        ☑ Click a <strong>row</strong> to select it — select multiple then hit <strong>Delete rows</strong>.
      </div>

      {/* Table */}
      <div className="af-table-wrap">
        <table className="af-table">
          <thead>
            <tr>
              <th className="af-th-check">
                <input
                  type="checkbox"
                  className="af-checkbox"
                  checked={allDisplayedSelected}
                  ref={el => { if (el) el.indeterminate = someDisplayedSelected && !allDisplayedSelected }}
                  onChange={() => toggleAll(displayedIds)}
                  title={allDisplayedSelected ? 'Deselect all' : 'Select all'}
                />
              </th>
              <th>Date</th>
              <th>Description</th>
              <th>Type</th>
              <th className="af-th-amount">Amount</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr><td colSpan={6} className="af-empty">No transactions match your filter.</td></tr>
            ) : (
              displayed.map(tx => {
                const isSelected = selected.has(tx.id)
                return (
                  <tr
                    key={tx.id}
                    className={[
                      tx.amount >= 0 ? 'af-row-income' : 'af-row-expense',
                      isSelected ? 'af-row-selected' : '',
                    ].join(' ')}
                    onClick={e => toggleRow(tx.id, e)}
                  >
                    <td className="af-td-check" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="af-checkbox"
                        checked={isSelected}
                        onChange={() => setSelected(prev => {
                          const next = new Set(prev)
                          next.has(tx.id) ? next.delete(tx.id) : next.add(tx.id)
                          return next
                        })}
                      />
                    </td>
                    <td className="af-td-date">
                      <EditableCell value={tx.date} onChange={v => patchTx(tx.id, { date: v })} />
                    </td>
                    <td className="af-td-desc">
                      <EditableCell value={tx.description} onChange={v => patchTx(tx.id, { description: v })} className="af-desc-input" />
                    </td>
                    <td>
                      <TypeCell value={tx.type} onChange={v => patchTx(tx.id, { type: v })} />
                    </td>
                    <td className={`af-td-amount ${tx.amount >= 0 ? 'af-income' : 'af-expense'}`}>
                      <EditableCell value={tx.amount} type="number" onChange={v => patchTx(tx.id, { amount: v })} className="af-amount-input" />
                    </td>
                    <td>
                      <CategoryCell
                        value={tx.category}
                        categories={allCategories}
                        onChange={v => patchTx(tx.id, { category: v })}
                        onAddCategory={handleAddCategory}
                      />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
