-- Trade / cost-code group on the WPM mirror -----------------------------------------
-- The Cash Flow cash-out drill-down groups work packages by trade (SITE WORKS /
-- MECHANICAL WORKS / ELECTRICAL AND AUXILIARY WORKS …, as the WPM app does). The
-- sync-wpm Edge Function auto-detects the trade from the WPM work_packages row
-- (first present of trade / cost_code_category / cost_code_group / category /
-- discipline / division / cost_code) and writes it here. Null → "Uncategorized".

alter table wpm_work_packages add column if not exists trade text;
