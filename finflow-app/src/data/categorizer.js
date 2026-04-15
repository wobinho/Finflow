// Auto-categorization engine based on description and transaction type patterns

export const CATEGORIES = [
  'Sales Revenue',
  'Client Payments / ACH',
  'Branch Deposits',
  'Wire Transfers',
  'Amazon / Online Shopping',
  'Travel & Transportation',
  'Meals & Entertainment',
  'Software & Subscriptions',
  'Payroll & Contractors',
  'Banking Fees',
  'Insurance',
  'Office Supplies & Hardware',
  'Fuel & Auto',
  'Advertising & Marketing',
  'Utilities & Communications',
  'Rent & Facilities',
  'Checks Issued',
  'Other Income',
  'Other Expense',
  'Uncategorized',
];

const rules = [
  // ── INCOME / DEPOSITS ──────────────────────────────────────────────────────
  {
    category: 'Branch Deposits',
    test: (d) => /deposit branch/i.test(d) || /withdrawal branch/i.test(d),
  },
  {
    category: 'Wire Transfers',
    test: (d) => /wire deposit|wire withdrawal|fedwire/i.test(d),
  },
  {
    category: 'Client Payments / ACH',
    test: (d) =>
      /ach single|ach paymen|ab custom|single ?inv|invoice|inv#|inv \d|singleorder/i.test(d),
  },
  {
    category: 'Sales Revenue',
    test: (d) =>
      /incomes|income|holdco|holdings ach|budding industry|northeast extra/i.test(d),
  },

  // ── AMAZON / ONLINE RETAIL ─────────────────────────────────────────────────
  {
    category: 'Amazon / Online Shopping',
    test: (d) => /amazon\.com|alibaba\.com/i.test(d),
  },

  // ── TRAVEL ─────────────────────────────────────────────────────────────────
  {
    category: 'Travel & Transportation',
    test: (d) =>
      /jetblue|southwest|southwes|airbnb|lyft|uber|mta\*lirr|u-haul|u-haulauction|smiths colonial motel|bkg\*hotel/i.test(d),
  },

  // ── MEALS & ENTERTAINMENT ──────────────────────────────────────────────────
  {
    category: 'Meals & Entertainment',
    test: (d) =>
      /paris baguette|moms kitchen|the place|the grand feast|sonic drive|flats 23|fuzzys|tst\*/i.test(d),
  },

  // ── SOFTWARE & SUBSCRIPTIONS ───────────────────────────────────────────────
  {
    category: 'Software & Subscriptions',
    test: (d) =>
      /intuit|qbooks|shopify|slack|apple\.com\/bill|frontier adhi|spectrum|godaddy|dnh\*|eledo\.online|unlim monthly/i.test(d),
  },

  // ── PAYROLL & CONTRACTORS ──────────────────────────────────────────────────
  {
    category: 'Payroll & Contractors',
    test: (d) => /gusto|paypal/i.test(d),
  },

  // ── BANKING FEES ───────────────────────────────────────────────────────────
  {
    category: 'Banking Fees',
    test: (d) =>
      /fee|ezpass|dec kbbo|kbb online|rebill ezp|foreign transaction|monthly fee|car report|slack rebate/i.test(d),
  },

  // ── INSURANCE ──────────────────────────────────────────────────────────────
  {
    category: 'Insurance',
    test: (d) => /insurance|dryden mutual|prog preferred|prem & pmt/i.test(d),
  },

  // ── OFFICE SUPPLIES & HARDWARE ─────────────────────────────────────────────
  {
    category: 'Office Supplies & Hardware',
    test: (d) =>
      /staples|uline|home depot|harbor freight|tractor supply|napa store|schuele ace|gih\*global/i.test(d),
  },

  // ── FUEL & AUTO ────────────────────────────────────────────────────────────
  {
    category: 'Fuel & Auto',
    test: (d) =>
      /shell oil|sunoco|speedway|exxon|circle k|bbt shell|canandaigua nat.*loan|ez mart|crosbys|tiger mart/i.test(d),
  },

  // ── ADVERTISING & MARKETING ────────────────────────────────────────────────
  {
    category: 'Advertising & Marketing',
    test: (d) => /sg \*phylos|in \*jahstudios|cut above/i.test(d),
  },

  // ── UTILITIES & COMMUNICATIONS ────────────────────────────────────────────
  {
    category: 'Utilities & Communications',
    test: (d) => /t-mobile|spectrum|bflo hydration/i.test(d),
  },

  // ── RENT & FACILITIES ──────────────────────────────────────────────────────
  {
    category: 'Rent & Facilities',
    test: (d) => /dumpster|hunny-dos/i.test(d),
  },

  // ── CHECKS ISSUED ──────────────────────────────────────────────────────────
  {
    category: 'Checks Issued',
    test: (d, type) => type === 'Check' || /paper check/i.test(d),
  },

  // ── LOAN / DEBT PAYMENTS ──────────────────────────────────────────────────
  {
    category: 'Other Expense',
    test: (d) => /capital one|1st bankcard|loan pmt/i.test(d),
  },
];

export function categorize(description, type) {
  const d = description || '';
  const t = type || '';
  for (const rule of rules) {
    if (rule.test(d, t)) return rule.category;
  }
  // Fallback by type
  if (t === 'Deposit') return 'Other Income';
  if (t === 'Fee') return 'Banking Fees';
  if (t === 'Check') return 'Checks Issued';
  if (t === 'Withdrawal') return 'Other Expense';
  return 'Uncategorized';
}

export function autoCategorizeAll(transactions) {
  return transactions.map((tx) => ({
    ...tx,
    category: tx.category || categorize(tx.description, tx.type),
  }));
}
