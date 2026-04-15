import { useRef, useState } from 'react'
import { parseFile, buildTransactions } from '../utils/fileParser'
import { autoCategorizeAll } from '../data/categorizer'
import ColumnMapper from './ColumnMapper'
import './ImportScreen.css'

export default function ImportScreen({ onImport }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Column-mapping state
  const [pendingParse, setPendingParse] = useState(null) // { headers, rows, mapping, fileName }

  async function handleFile(file) {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      setError('Please upload an XLSX, XLS, or CSV file.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const result = await parseFile(file)
      setLoading(false)

      // If essential columns weren't detected, show the mapper
      const needsMapping =
        result.mapping.date < 0 ||
        result.mapping.description < 0 ||
        (result.mapping.amount < 0 && result.mapping.credit < 0 && result.mapping.debit < 0)

      if (needsMapping) {
        setPendingParse({ ...result, fileName: file.name })
      } else {
        finalize(result.rows, result.headers, result.mapping, file.name)
      }
    } catch (e) {
      setLoading(false)
      setError(e.message || 'Failed to parse file.')
    }
  }

  function finalize(rows, headers, mapping, fileName = '') {
    const transactions = buildTransactions(rows, headers, mapping)
    if (transactions.length === 0) {
      setError('No valid transactions found. Check that your file has Date, Description, and Amount columns.')
      setPendingParse(null)
      return
    }
    const categorized = autoCategorizeAll(transactions)
    onImport(categorized, fileName)
  }

  // Drag-and-drop handlers
  function onDragOver(e) { e.preventDefault(); setDragging(true) }
  function onDragLeave()  { setDragging(false) }
  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    handleFile(file)
  }

  if (pendingParse) {
    return (
      <ColumnMapper
        headers={pendingParse.headers}
        rows={pendingParse.rows}
        initialMapping={pendingParse.mapping}
        onConfirm={(mapping) => finalize(pendingParse.rows, pendingParse.headers, mapping, pendingParse.fileName)}
        onBack={() => setPendingParse(null)}
      />
    )
  }

  return (
    <div className="import-screen">
      <div className="import-card">
        <div className="import-logo">◈</div>
        <h1 className="import-title">FinFlow</h1>
        <p className="import-subtitle">Transaction Categorizer</p>

        <div
          className={`drop-zone ${dragging ? 'drag-over' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])}
          />
          {loading ? (
            <div className="drop-loading">
              <span className="spinner" />
              <p>Parsing file…</p>
            </div>
          ) : (
            <>
              <div className="drop-icon">↑</div>
              <p className="drop-primary">Drop your bank export here</p>
              <p className="drop-secondary">or <span className="drop-link">click to browse</span></p>
              <p className="drop-formats">XLSX &nbsp;·&nbsp; XLS &nbsp;·&nbsp; CSV</p>
            </>
          )}
        </div>

        {error && <p className="import-error">{error}</p>}

        <div className="import-hints">
          <p className="hints-title">Expected columns</p>
          <ul className="hints-list">
            <li><strong>Date</strong> — transaction date</li>
            <li><strong>Description</strong> — vendor / memo</li>
            <li><strong>Amount</strong> — single column <em>or</em> separate Debit / Credit</li>
            <li><strong>Type</strong> — optional (Deposit, Withdrawal, etc.)</li>
          </ul>
          <p className="hints-note">Don't have the right column names? We'll ask you to map them.</p>
        </div>
      </div>
    </div>
  )
}
