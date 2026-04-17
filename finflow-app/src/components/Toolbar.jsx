import { CATEGORIES } from '../data/categorizer'
import './Toolbar.css'

const TYPES = ['All', 'Deposit', 'Withdrawal', 'Check', 'Fee']

export default function Toolbar({
  search, onSearch,
  filterCategory, onFilterCategory,
  filterType, onFilterType,
  onBulkRecategorize,
  onExportCSV, onExportXLSX,
  onExportCSVNoCategory, onExportXLSXNoCategory,
  onExportQBO,
  resultCount, totalCount,
}) {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input
            className="search-input"
            type="text"
            placeholder="Search descriptions, categories…"
            value={search}
            onChange={e => onSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => onSearch('')} title="Clear">✕</button>
          )}
        </div>

        <select
          className="filter-select"
          value={filterCategory}
          onChange={e => onFilterCategory(e.target.value)}
        >
          <option value="All">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <select
          className="filter-select"
          value={filterType}
          onChange={e => onFilterType(e.target.value)}
        >
          {TYPES.map(t => <option key={t} value={t}>{t === 'All' ? 'All Types' : t}</option>)}
        </select>

        <span className="result-count">
          {resultCount === totalCount
            ? `${totalCount} transactions`
            : `${resultCount} of ${totalCount}`}
        </span>
      </div>

      <div className="toolbar-right">
        <button className="btn btn-ghost" onClick={onBulkRecategorize} title="Reset all categories to auto-detected">
          ↺ Re-categorize All
        </button>
        <button className="btn btn-outline" onClick={onExportCSV} title="CSV with category">
          ↓ CSV
        </button>
        <button className="btn btn-outline" onClick={onExportCSVNoCategory} title="CSV without category">
          ↓ CSV (no cat.)
        </button>
        <button className="btn btn-primary" onClick={onExportXLSX} title="XLSX with category">
          ↓ XLSX
        </button>
        <button className="btn btn-primary" onClick={onExportXLSXNoCategory} title="XLSX without category">
          ↓ XLSX (no cat.)
        </button>
        <button className="btn btn-outline" onClick={onExportQBO} title="QuickBooks IIF format">
          ↓ QBO
        </button>
      </div>
    </div>
  )
}
