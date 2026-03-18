# Auto Narrative Agent v4

AI-powered BI dashboard. Upload data once to Neon Postgres, describe it with metadata, and get LLM-generated SQL queries, live charts, and narrative summaries.

---

## Architecture

```
User selects dataset + metadata (existing or upload new)
              ↓
LLM reads metadata → generates SQL queries
              ↓
Queries run against Neon Postgres
              ↓
Results render as KPI cards + charts
              ↓
[Generate AI Summary] → LLM reads results → narrative
```

---

## Setup Steps

### 1. Create Neon database on Vercel
- Vercel → your project → Storage → Create Database → Neon Postgres
- Vercel auto-adds DATABASE_URL to your environment variables

### 2. Add environment variables in Vercel
| Key | Value |
|-----|-------|
| DATABASE_URL | Auto-added by Vercel Neon setup |
| OPENROUTER_API_KEY | Your key from https://openrouter.ai |

### 3. Deploy to Vercel
- Push this repo to GitHub
- Vercel → Add New → Project → Import repo
- Deploy

### 4. Run database setup (one time only)
- Visit: https://your-app.vercel.app/api/setup-db
- You should see: "All tables created successfully."

### 5. Use the app
- Go to your app URL
- Upload your dataset Excel file
- Upload your metadata Excel file
- Click Build Dashboard
- Click Generate AI Summary

---

## Switching Database

To switch from Neon to another database, only edit lib/db.js:
1. Comment out the Neon adapter section
2. Uncomment the adapter you want (Supabase or standard Postgres)
3. Add the correct env variable to Vercel
4. Redeploy

No other files need changing.

---

## Metadata File Format

Required columns (must have these exact names):
- field_name — must match column headers in your data file
- type — one of: kpi, derived_kpi, dimension, datetime, id
- display_name — human readable label shown on dashboard

Optional columns (leave blank if not applicable):
- unit — e.g. USD, %, count
- definition — what this field means
- aggregation — SUM, AVG, COUNT, MAX, MIN
- calculation_logic — for derived KPIs only
- dependencies — fields used in derived calculation
- sample_values — 2-3 example values
- business_priority — High, Medium, Low
- filters_applicable — common filter dimensions
- time_grain — monthly, daily, quarterly (for datetime fields)
- benchmark — target or threshold value

---

## File Structure

```
ana-v4/
├── app/
│   ├── globals.css
│   ├── layout.jsx
│   ├── page.jsx
│   └── api/
│       ├── setup-db/route.js        — create DB tables (run once)
│       ├── datasets/route.js        — list saved datasets
│       ├── upload-dataset/route.js  — upload Excel to Postgres
│       ├── metadata-sets/route.js   — list saved metadata sets
│       ├── save-metadata/route.js   — upload metadata to Postgres
│       ├── generate-queries/route.js — LLM generates SQL from metadata
│       ├── run-queries/route.js     — execute SQL on Postgres
│       └── generate-summary/route.js — LLM generates narrative from results
├── components/
│   ├── SetupScreen.jsx   — select/upload data and metadata
│   ├── Dashboard.jsx     — renders charts and KPI cards
│   ├── KPICard.jsx       — individual metric card
│   └── SummaryPanel.jsx  — AI narrative display
├── lib/
│   ├── db.js             — database abstraction layer
│   └── parseData.js      — number formatting utilities
└── README.md
```
