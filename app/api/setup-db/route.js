import { execute, ping } from '../../../lib/db'

export async function GET() {
  try {
    var ok = await ping()
    if (!ok) {
      return Response.json({ error: 'Cannot connect to database. Check DATABASE_URL.' }, { status: 500 })
    }

    await execute(`
      CREATE TABLE IF NOT EXISTS datasets (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        row_count INTEGER DEFAULT 0,
        columns TEXT,
        uploaded_at TIMESTAMP DEFAULT NOW()
      )
    `)

    await execute(`
      CREATE TABLE IF NOT EXISTS dataset_rows (
        id SERIAL PRIMARY KEY,
        dataset_id INTEGER REFERENCES datasets(id) ON DELETE CASCADE,
        data JSONB NOT NULL
      )
    `)

    await execute(`
      CREATE TABLE IF NOT EXISTS metadata_sets (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        uploaded_at TIMESTAMP DEFAULT NOW()
      )
    `)

    await execute(`
      CREATE TABLE IF NOT EXISTS metadata_rows (
        id SERIAL PRIMARY KEY,
        metadata_set_id INTEGER REFERENCES metadata_sets(id) ON DELETE CASCADE,
        field_name TEXT NOT NULL,
        display_name TEXT,
        type TEXT,
        data_type TEXT,
        unit TEXT,
        definition TEXT,
        aggregation TEXT,
        calculation_logic TEXT,
        dependencies TEXT,
        sample_values TEXT,
        business_priority TEXT,
        filters_applicable TEXT,
        time_grain TEXT,
        benchmark TEXT,
        accumulation_type TEXT
      )
    `)

    // Safe migration — add accumulation_type if upgrading from older schema
    try {
      await execute(`ALTER TABLE metadata_rows ADD COLUMN IF NOT EXISTS accumulation_type TEXT`)
    } catch (e) {
      // Column already exists on some Postgres versions that don't support IF NOT EXISTS
    }

    return Response.json({ message: 'All tables created successfully. Your database is ready.' })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
