-- Add award/procurement/delivery status to the WPM mirror -------------------
-- Lets the Cash Flow module ground "actual" cash-out in real awarded status:
-- awarded work packages whose payments fall on/before the data date are actual;
-- awarded remainder + un-awarded packages are forecast.

alter table wpm_work_packages add column if not exists award_status       text;
alter table wpm_work_packages add column if not exists procurement_status text;
alter table wpm_work_packages add column if not exists delivery_status     text;
