-- ============================================
-- BLACKCODE ISSUES - Projects Table Extension
-- Adds additional fields for project editing
-- ============================================

-- Add new columns to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'P2';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'team';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS color VARCHAR(10) DEFAULT '#3B82F6';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS icon_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date DATE;

-- ============================================
-- Run this migration on your database
-- ============================================
