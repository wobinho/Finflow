import { useState } from 'react'
import './ColumnMapper.css'

const FIELDS = [
  { key: 'date',        label: 'Date',        required: true,  hint: 'Transaction date' },
  { key: 'description', label: 'Description', required: true,  hint: 'Vendor name or memo' },
  { key: 'amount',      label: 'Amount',      required: false, hint: 'Single debit/credit column' },
  { key: 'debit',       label: 'Debit',       required: false, hint: 'Withdrawals / charges (positive numbers)' },
  { key: 'credit',      label: 'Credit',      required: false, hint: 'Deposits / payments (positive numbers)' },
  { key: 'type',        label: 'Type',        required: false, hint: 'Transaction type label (optional)' },
]

function PreviewTable({ headers, rows, mapping }) {
  const shown = rows.slice(0, 4)
  const activeCols = Object.values(mapping).filter(i => i >= 0)
  return (
    <div className="mapper-preview-wrap">
      <table className="mapper-preview-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className={activeCols.includes(i) ? 'mapped-col' : ''}>
                {h || <em className="empty-header">col {i + 1}</em>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, ri) => (
            <tr key={ri}>
              {headers.map((_, ci) => (
                <td key={ci} className={activeCols.includes(ci) ? 'mapped-col' : ''}>
                  {String(row[ci] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ColumnMapper({ headers, rows, initialMapping, onConfirm, onBack }) {
  const [mapping, setMapping] = useState({ ...initialMapping })
  const [error, setError] = useState('')

  function setField(field, idx) {
    setMapping(prev => ({ ...prev, [field]: Number(idx) }))
  }

  function validate() {
    if (mapping.date < 0) return 'Please map the Date column.'
    if (mapping.description < 0) return 'Please map the Description column.'
    const hasAmount = mapping.amount >= 0
    const hasSplit  = mapping.credit >= 0 || mapping.debit >= 0
    if (!hasAmount && !hasSplit) return 'Please map either an Amount column, or Debit / Credit columns.'
    return ''
  }

  function handleConfirm() {
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    onConfirm(mapping)
  }

  const options = [
    <option key="-1" value="-1">— not mapped —</option>,
    ...headers.map((h, i) => (
      <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
    )),
  ]

  return (
    <div className="mapper-screen">
      <div className="mapper-card">
        <button className="mapper-back" onClick={onBack}>← Back</button>
        <h2 className="mapper-title">Map your columns</h2>
        <p className="mapper-subtitle">
          We couldn't automatically detect all required columns. Tell us which column contains each field.
        </p>

        <PreviewTable headers={headers} rows={rows} mapping={mapping} />

        <div className="mapper-fields">
          {FIELDS.map(f => (
            <div key={f.key} className="mapper-row">
              <div className="mapper-label-wrap">
                <span className="mapper-label">
                  {f.label}
                  {f.required && <span className="mapper-required"> *</span>}
                </span>
                <span className="mapper-hint">{f.hint}</span>
              </div>
              <select
                className={`mapper-select ${mapping[f.key] >= 0 ? 'mapped' : ''}`}
                value={mapping[f.key] ?? -1}
                onChange={e => setField(f.key, e.target.value)}
              >
                {options}
              </select>
            </div>
          ))}
        </div>

        {error && <p className="mapper-error">{error}</p>}

        <div className="mapper-actions">
          <button className="btn btn-ghost" onClick={onBack}>Cancel</button>
          <button className="btn btn-primary" onClick={handleConfirm}>
            Apply &amp; Categorize →
          </button>
        </div>
      </div>
    </div>
  )
}
