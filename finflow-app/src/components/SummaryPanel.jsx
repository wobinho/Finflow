import './SummaryPanel.css'

function fmt(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function SummaryPanel({ summary, onFilterCategory, activeCategory }) {
  const { byCategory, totalIncome, totalExpense } = summary
  const net = totalIncome - totalExpense

  // Sort categories by total volume descending
  const sorted = Object.entries(byCategory).sort(
    ([, a], [, b]) => (b.income + b.expense) - (a.income + a.expense)
  )

  const maxVol = sorted.length > 0
    ? Math.max(...sorted.map(([, v]) => v.income + v.expense))
    : 1

  return (
    <div className="summary-panel">
      <div className="sp-section sp-totals">
        <h2 className="sp-title">Overview</h2>
        <div className="sp-overview-row">
          <span className="sp-ov-label">Income</span>
          <span className="sp-ov-val income">${fmt(totalIncome)}</span>
        </div>
        <div className="sp-overview-row">
          <span className="sp-ov-label">Expenses</span>
          <span className="sp-ov-val expense">${fmt(totalExpense)}</span>
        </div>
        <div className="sp-overview-divider" />
        <div className="sp-overview-row sp-net-row">
          <span className="sp-ov-label net-label">Net</span>
          <span className={`sp-ov-val net-val ${net >= 0 ? 'income' : 'expense'}`}>
            {net < 0 ? '-' : ''}${fmt(Math.abs(net))}
          </span>
        </div>
      </div>

      <div className="sp-section">
        <div className="sp-cat-header">
          <h2 className="sp-title">Categories</h2>
          {activeCategory !== 'All' && (
            <button className="sp-clear-btn" onClick={() => onFilterCategory('All')}>
              Clear filter
            </button>
          )}
        </div>

        <ul className="sp-cat-list">
          {sorted.map(([cat, vals]) => {
            const vol = vals.income + vals.expense
            const pct = Math.round((vol / maxVol) * 100)
            const isActive = activeCategory === cat
            return (
              <li
                key={cat}
                className={`sp-cat-item ${isActive ? 'active' : ''}`}
                onClick={() => onFilterCategory(isActive ? 'All' : cat)}
              >
                <div className="sp-cat-top">
                  <span className="sp-cat-name">{cat}</span>
                  <span className="sp-cat-count">{vals.count}</span>
                </div>
                <div className="sp-cat-bar-track">
                  <div className="sp-cat-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="sp-cat-amounts">
                  {vals.income > 0 && (
                    <span className="sp-cat-income">+${fmt(vals.income)}</span>
                  )}
                  {vals.expense > 0 && (
                    <span className="sp-cat-expense">-${fmt(vals.expense)}</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
