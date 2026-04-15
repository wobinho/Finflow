import { useState, useMemo, useCallback, useRef } from 'react'
import { autoCategorizeAll } from './data/categorizer'
import ImportScreen from './components/ImportScreen'
import TransactionTable from './components/TransactionTable'
import SummaryPanel from './components/SummaryPanel'
import Toolbar from './components/Toolbar'
import { exportToCSV, exportToXLSX } from './utils/exporter'
import { parseFile, buildTransactions } from './utils/fileParser'
import './App.css'

export default function App() {
  const [transactions, setTransactions] = useState(null)   // null = no file loaded yet
  const [fileName, setFileName] = useState('')
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('All')
  const [filterType, setFilterType] = useState('All')
  const [sortConfig, setSortConfig] = useState({ key: 'date', dir: 'asc' })
  const fileInputRef = useRef(null)

  // Called by ImportScreen once a file is parsed & categorized
  const handleImport = useCallback((categorized, name = '') => {
    setTransactions(categorized)
    setFileName(name)
    setSearch('')
    setFilterCategory('All')
    setFilterType('All')
  }, [])

  const handleCategoryChange = useCallback((id, newCat) => {
    setTransactions(prev =>
      prev.map(tx => tx.id === id ? { ...tx, category: newCat } : tx)
    )
  }, [])

  const handleBulkRecategorize = useCallback(() => {
    setTransactions(prev => autoCategorizeAll(prev.map(tx => ({ ...tx, category: '' }))))
  }, [])

  const handleNewFile = useCallback(() => {
    // Reset back to the import screen
    setTransactions(null)
    setFileName('')
    setSearch('')
    setFilterCategory('All')
    setFilterType('All')
  }, [])

  const filtered = useMemo(() => {
    if (!transactions) return []
    let rows = transactions

    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(
        tx =>
          tx.description.toLowerCase().includes(q) ||
          tx.category.toLowerCase().includes(q) ||
          tx.type.toLowerCase().includes(q)
      )
    }

    if (filterCategory !== 'All') {
      rows = rows.filter(tx => tx.category === filterCategory)
    }

    if (filterType !== 'All') {
      rows = rows.filter(tx => tx.type === filterType)
    }

    const { key, dir } = sortConfig
    rows = [...rows].sort((a, b) => {
      let av = a[key], bv = b[key]
      if (key === 'amount') { av = Number(av); bv = Number(bv) }
      if (av < bv) return dir === 'asc' ? -1 : 1
      if (av > bv) return dir === 'asc' ? 1 : -1
      return 0
    })

    return rows
  }, [transactions, search, filterCategory, filterType, sortConfig])

  const summary = useMemo(() => {
    const src = transactions ?? []
    const byCategory = {}
    for (const tx of src) {
      if (!byCategory[tx.category]) byCategory[tx.category] = { income: 0, expense: 0, count: 0 }
      const amt = tx.amount
      if (amt >= 0) byCategory[tx.category].income += amt
      else byCategory[tx.category].expense += Math.abs(amt)
      byCategory[tx.category].count++
    }
    const totalIncome  = src.reduce((s, tx) => tx.amount > 0 ? s + tx.amount : s, 0)
    const totalExpense = src.reduce((s, tx) => tx.amount < 0 ? s + Math.abs(tx.amount) : s, 0)
    return { byCategory, totalIncome, totalExpense }
  }, [transactions])

  const handleSort = useCallback((key) => {
    setSortConfig(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    )
  }, [])

  // ── No file loaded yet — show import screen ────────────────────────────────
  if (!transactions) {
    return <ImportScreen onImport={(data, name) => handleImport(data, name)} />
  }

  // ── File loaded — show the main UI ─────────────────────────────────────────
  const net = summary.totalIncome - summary.totalExpense
  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <span className="logo-icon">◈</span>
          <div>
            <h1>FinFlow</h1>
            {fileName && <p className="tagline">{fileName}</p>}
          </div>
        </div>

        <div className="header-stats">
          <div className="stat">
            <span className="stat-label">Income</span>
            <span className="stat-value income">${fmt(summary.totalIncome)}</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-label">Expenses</span>
            <span className="stat-value expense">${fmt(summary.totalExpense)}</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-label">Net</span>
            <span className={`stat-value ${net >= 0 ? 'income' : 'expense'}`}>${fmt(net)}</span>
          </div>
          <div className="stat-divider" />
          <button className="btn-import-new" onClick={handleNewFile}>
            ↑ Import new file
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <SummaryPanel
            summary={summary}
            onFilterCategory={setFilterCategory}
            activeCategory={filterCategory}
          />
        </aside>

        <main className="main-content">
          <Toolbar
            search={search}
            onSearch={setSearch}
            filterCategory={filterCategory}
            onFilterCategory={setFilterCategory}
            filterType={filterType}
            onFilterType={setFilterType}
            onBulkRecategorize={handleBulkRecategorize}
            onExportCSV={() => exportToCSV(filtered)}
            onExportXLSX={() => exportToXLSX(filtered)}
            resultCount={filtered.length}
            totalCount={transactions.length}
          />
          <TransactionTable
            transactions={filtered}
            sortConfig={sortConfig}
            onSort={handleSort}
            onCategoryChange={handleCategoryChange}
          />
        </main>
      </div>
    </div>
  )
}
