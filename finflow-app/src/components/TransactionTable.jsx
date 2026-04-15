import { useState } from 'react'
import { CATEGORIES } from '../data/categorizer'
import './TransactionTable.css'

const TYPE_COLORS = {
  Deposit: 'badge-green',
  Withdrawal: 'badge-red',
  Check: 'badge-orange',
  Fee: 'badge-gray',
}

function SortIcon({ active, dir }) {
  if (!active) return <span className="sort-icon inactive">↕</span>
  return <span className="sort-icon active">{dir === 'asc' ? '↑' : '↓'}</span>
}

export default function TransactionTable({ transactions, sortConfig, onSort, onCategoryChange }) {
  const [editingId, setEditingId] = useState(null)

  const cols = [
    { key: 'date', label: 'Date', sortable: true },
    { key: 'description', label: 'Description', sortable: true },
    { key: 'type', label: 'Type', sortable: true },
    { key: 'amount', label: 'Amount', sortable: true },
    { key: 'category', label: 'Category', sortable: true },
  ]

  function formatDate(d) {
    if (!d) return '—'
    const [y, m, day] = d.split('-')
    return `${m}/${day}/${y}`
  }

  function formatAmount(amt) {
    const n = Number(amt)
    const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return n < 0 ? `-$${abs}` : `$${abs}`
  }

  return (
    <div className="table-wrapper">
      <table className="tx-table">
        <thead>
          <tr>
            {cols.map(col => (
              <th
                key={col.key}
                className={`col-${col.key}${col.sortable ? ' sortable' : ''}`}
                onClick={col.sortable ? () => onSort(col.key) : undefined}
              >
                <span className="th-inner">
                  {col.label}
                  {col.sortable && (
                    <SortIcon active={sortConfig.key === col.key} dir={sortConfig.dir} />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-row">No transactions match your filters.</td>
            </tr>
          )}
          {transactions.map(tx => (
            <tr
              key={tx.id}
              className={`tx-row ${Number(tx.amount) < 0 ? 'is-expense' : 'is-income'}`}
            >
              <td className="col-date">{formatDate(tx.date)}</td>
              <td className="col-description" title={tx.description}>
                <span className="desc-text">{tx.description}</span>
              </td>
              <td className="col-type">
                <span className={`badge ${TYPE_COLORS[tx.type] || 'badge-gray'}`}>
                  {tx.type}
                </span>
              </td>
              <td className={`col-amount ${Number(tx.amount) < 0 ? 'amount-neg' : 'amount-pos'}`}>
                {formatAmount(tx.amount)}
              </td>
              <td className="col-category">
                {editingId === tx.id ? (
                  <select
                    className="cat-select open"
                    value={tx.category}
                    autoFocus
                    onChange={e => {
                      onCategoryChange(tx.id, e.target.value)
                      setEditingId(null)
                    }}
                    onBlur={() => setEditingId(null)}
                  >
                    {CATEGORIES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <button
                    className="cat-pill"
                    onClick={() => setEditingId(tx.id)}
                    title="Click to edit category"
                  >
                    {tx.category || 'Uncategorized'}
                    <span className="edit-icon">✎</span>
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
