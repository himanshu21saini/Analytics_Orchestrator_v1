// ============================================================
// lib/db.js — Database abstraction layer
//
// TO SWITCH DATABASE: only edit the ACTIVE ADAPTER section.
// All API routes import from here — nothing else ever changes.
//
// Available adapters:
//   neon      → Neon / Vercel Postgres (ACTIVE)
//   supabase  → Supabase Postgres
//   postgres  → Any standard Postgres (AWS, Railway, PlanetScale)
// ============================================================

import { neon } from '@neondatabase/serverless'

// ============================================================
// ACTIVE ADAPTER: NEON
// Env variable needed: DATABASE_URL
// Get it from: Vercel → Storage → Create Database → Neon Postgres
// ============================================================
function getDb() {
var url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING
if (!url) throw new Error('No database URL found. Check Vercel environment variables.')

  return neon(url)
}

// ============================================================
// ADAPTER: SUPABASE (uncomment to use)
// Env variable needed: SUPABASE_DATABASE_URL
// Get it from: Supabase dashboard → Settings → Database → Connection string
// ============================================================
// import postgres from 'postgres'
// function getDb() {
//   var url = process.env.SUPABASE_DATABASE_URL
//   if (!url) throw new Error('SUPABASE_DATABASE_URL is not set.')
//   var sql = postgres(url, { ssl: 'require' })
//   return async function(query, params) {
//     return await sql.unsafe(query, params || [])
//   }
// }

// ============================================================
// ADAPTER: STANDARD POSTGRES — AWS RDS, Railway, any Postgres
// Env variable needed: POSTGRES_URL
// ============================================================
// import { Pool } from 'pg'
// var pool
// function getDb() {
//   if (!pool) pool = new Pool({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } })
//   return async function(query, params) {
//     var result = await pool.query(query, params || [])
//     return result.rows
//   }
// }

// ============================================================
// PUBLIC API — the only functions your routes ever call
// ============================================================

export async function query(sql, params) {
  try {
    var db = getDb()
    var result = await db(sql, params || [])
    return Array.isArray(result) ? result : []
  } catch (err) {
    console.error('DB query error:', err.message)
    throw new Error('Database error: ' + err.message)
  }
}

export async function queryOne(sql, params) {
  var rows = await query(sql, params)
  return rows[0] || null
}

export async function execute(sql, params) {
  return await query(sql, params)
}

export async function ping() {
  try {
    await query('SELECT 1')
    return true
  } catch (e) {
    return false
  }
}
