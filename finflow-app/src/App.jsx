import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { autoCategorizeAll } from './data/categorizer'
import ImportScreen from './components/ImportScreen'
import TransactionTable from './components/TransactionTable'
import SummaryPanel from './components/SummaryPanel'
import Toolbar from './components/Toolbar'
import AuditFlow from './components/AuditFlow'
import { exportToCSV, exportToXLSX, exportToCSVNoCategory, exportToXLSXNoCategory, exportToQBO } from './utils/exporter'
import './App.css'

// ── Shared tab nav ────────────────────────────────────────────────────────────
function TabNav({ active, onChange }) {
  return (
    <nav className="app-tabs">
      <button
        className={`app-tab ${active === 'finflow' ? 'active' : ''}`}
        onClick={() => onChange('finflow')}
      >
        FinFlow
        <span className="tab-badge">Categorizer</span>
      </button>
      <button
        className={`app-tab ${active === 'auditflow' ? 'active' : ''}`}
        onClick={() => onChange('auditflow')}
      >
        AuditFlow
        <span className="tab-badge tab-badge-teal">PDF → QB</span>
      </button>
    </nav>
  )
}

export default function App() {
  const [activeSection, setActiveSection] = useState('finflow')

  // ── FinFlow state ─────────────────────────────────────────────────────────
  const [transactions, setTransactions] = useState(null)
  const [fileName, setFileName]         = useState('')
  const [search, setSearch]             = useState('')
  const [filterCategory, setFilterCategory] = useState('All')
  const [filterType, setFilterType]     = useState('All')
  const [sortConfig, setSortConfig]     = useState({ key: 'date', dir: 'asc' })
  const fileInputRef = useRef(null)

  const handleImport = useCallback((categorized, name = '') => {
    setTransactions(categorized)
    setFileName(name)
    setSearch('')
    setFilterCategory('All')
    setFilterType('All')
  }, [])

  const handleCategoryChange = useCallback((id, newCat) => {
    setTransactions(prev => prev.map(tx => tx.id === id ? { ...tx, category: newCat } : tx))
  }, [])

  const handleBulkRecategorize = useCallback(() => {
    setTransactions(prev => autoCategorizeAll(prev.map(tx => ({ ...tx, category: '' }))))
  }, [])

  const handleNewFile = useCallback(() => {
    setTransactions(null); setFileName(''); setSearch('')
    setFilterCategory('All'); setFilterType('All')
  }, [])

  const filtered = useMemo(() => {
    if (!transactions) return []
    let rows = transactions
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(tx =>
        tx.description.toLowerCase().includes(q) ||
        tx.category.toLowerCase().includes(q) ||
        tx.type.toLowerCase().includes(q)
      )
    }
    if (filterCategory !== 'All') rows = rows.filter(tx => tx.category === filterCategory)
    if (filterType !== 'All')     rows = rows.filter(tx => tx.type === filterType)
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
      if (tx.amount >= 0) byCategory[tx.category].income += tx.amount
      else byCategory[tx.category].expense += Math.abs(tx.amount)
      byCategory[tx.category].count++
    }
    const totalIncome  = src.reduce((s, tx) => tx.amount > 0 ? s + tx.amount : s, 0)
    const totalExpense = src.reduce((s, tx) => tx.amount < 0 ? s + Math.abs(tx.amount) : s, 0)
    return { byCategory, totalIncome, totalExpense }
  }, [transactions])

  const handleSort = useCallback((key) => {
    setSortConfig(prev =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )
  }, [])

  // ── AuditFlow persistent state ────────────────────────────────────────────
  const [afStage, setAfStage]                   = useState('idle')
  const [afTransactions, setAfTransactions]     = useState([])
  const [afFileName, setAfFileName]             = useState('')
  const [afPageCount, setAfPageCount]           = useState(0)
  const [afOcrPageCount, setAfOcrPageCount]     = useState(0)
  const [afCustomCategories, setAfCustomCategories] = useState([])
  const [afSortMode, setAfSortMode]             = useState('original')
  const [afSearch, setAfSearch]                 = useState('')
  const [afFilterType, setAfFilterType]         = useState('All')

  // ── Privacy: wipe all transaction data when the tab/window closes ────────
  useEffect(() => {
    const clearAll = () => {
      setTransactions(null)
      setFileName('')
      setSearch('')
      setFilterCategory('All')
      setFilterType('All')
      setAfStage('idle')
      setAfTransactions([])
      setAfFileName('')
      setAfPageCount(0)
      setAfOcrPageCount(0)
      setAfCustomCategories([])
      setAfSortMode('original')
      setAfSearch('')
      setAfFilterType('All')
    }
    window.addEventListener('beforeunload', clearAll)
    // pagehide fires on mobile and when bfcache takes the page
    window.addEventListener('pagehide', clearAll)
    return () => {
      window.removeEventListener('beforeunload', clearAll)
      window.removeEventListener('pagehide', clearAll)
    }
  }, [])

  // ── Derived ───────────────────────────────────────────────────────────────
  const net = summary.totalIncome - summary.totalExpense
  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // ── Render ────────────────────────────────────────────────────────────────

  // FinFlow — no file loaded
  if (activeSection === 'finflow' && !transactions) {
    return (
      <div className="app">
        <header className="app-header">
          <div className="header-brand">
            <span className="logo-icon">◈</span>
            <div><h1>FinFlow</h1></div>
          </div>
          <TabNav active={activeSection} onChange={setActiveSection} />
        </header>
        <ImportScreen onImport={handleImport} />
      </div>
    )
  }

  // AuditFlow
  if (activeSection === 'auditflow') {
    return (
      <div className="app">
        <header className="app-header">
          <div className="header-brand">
            <span className="logo-icon logo-icon-teal">⬡</span>
            <div>
              <h1>AuditFlow</h1>
              <p className="tagline">PDF Bank Statement Converter</p>
            </div>
          </div>
          <TabNav active={activeSection} onChange={setActiveSection} />
        </header>
        <div className="app-body app-body-full">
          <AuditFlow
            stage={afStage}               setStage={setAfStage}
            transactions={afTransactions} setTransactions={setAfTransactions}
            fileName={afFileName}         setFileName={setAfFileName}
            pageCount={afPageCount}       setPageCount={setAfPageCount}
            ocrPageCount={afOcrPageCount} setOcrPageCount={setAfOcrPageCount}
            customCategories={afCustomCategories} setCustomCategories={setAfCustomCategories}
            sortMode={afSortMode}         setSortMode={setAfSortMode}
            search={afSearch}             setSearch={setAfSearch}
            filterType={afFilterType}     setFilterType={setAfFilterType}
          />
        </div>
      </div>
    )
  }

  // FinFlow — file loaded
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

        <TabNav active={activeSection} onChange={setActiveSection} />

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
            onExportCSVNoCategory={() => exportToCSVNoCategory(filtered)}
            onExportXLSX={() => exportToXLSX(filtered)}
            onExportXLSXNoCategory={() => exportToXLSXNoCategory(filtered)}
            onExportQBO={() => exportToQBO(filtered)}
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
