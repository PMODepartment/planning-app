-- One-time backfill of WPM trades into the mirror for SLN101 --------------------------
-- The authoritative trade for every SLN101 work package, taken from the WPM import
-- ("EPC. PMO. Import WP. SLN101. 2026 06 11"). Run this in the Supabase SQL editor
-- (Planners project) to populate wpm_work_packages.trade immediately, without waiting
-- on a sync-wpm redeploy. Idempotent (re-runnable). Requires the trade column first
-- (migrations/2026-07-14-wpm-mirror-trade.sql).
--
-- NOTE: this is a SNAPSHOT. The durable source is the sync-wpm Edge Function (which now
-- copies trade). Once that is redeployed + re-synced, every sync keeps trade current and
-- this script is no longer needed.

update wpm_work_packages m
set trade = v.trade
from (values
    ('1','General Requirements'),
    ('2','General Requirements'),
    ('3','General Requirements'),
    ('4','General Requirements'),
    ('5','General Requirements'),
    ('6','General Requirements'),
    ('7','General Requirements'),
    ('8','General Requirements'),
    ('9','General Requirements'),
    ('10','General Requirements'),
    ('11','General Requirements'),
    ('12','General Requirements'),
    ('13','General Requirements'),
    ('14','General Requirements'),
    ('15','General Requirements'),
    ('16','General Requirements'),
    ('17','General Requirements'),
    ('18','General Requirements'),
    ('19','General Requirements'),
    ('20','General Requirements'),
    ('21','General Requirements'),
    ('22','General Requirements'),
    ('23','General Requirements'),
    ('24','General Requirements'),
    ('25','General Requirements'),
    ('26','General Requirements'),
    ('27','Structural Works'),
    ('28','Structural Works'),
    ('29','Structural Works'),
    ('30','Structural Works'),
    ('31','Structural Works'),
    ('32','Structural Works'),
    ('33','Structural Works'),
    ('34','Structural Works'),
    ('35','Structural Works'),
    ('36','Structural Works'),
    ('37','Structural Works'),
    ('38','Structural Works'),
    ('39','Structural Works'),
    ('40','Structural Works'),
    ('41','Architectural Works'),
    ('42','Architectural Works'),
    ('43','Architectural Works'),
    ('44','Architectural Works'),
    ('45','Architectural Works'),
    ('46','Architectural Works'),
    ('47','Architectural Works'),
    ('48','Architectural Works'),
    ('49','Architectural Works'),
    ('50','Architectural Works'),
    ('51','Architectural Works'),
    ('52','Architectural Works'),
    ('53','Architectural Works'),
    ('54','Architectural Works'),
    ('55','Architectural Works'),
    ('56','Architectural Works'),
    ('57','Architectural Works'),
    ('58','Architectural Works'),
    ('59','Architectural Works'),
    ('60','Architectural Works'),
    ('61','Architectural Works'),
    ('62','Mechanical Works'),
    ('63','Mechanical Works'),
    ('64','Electrical and Auxiliary Works'),
    ('65','Electrical and Auxiliary Works'),
    ('66','Electrical and Auxiliary Works'),
    ('67','Fire Protection Works'),
    ('68','Electrical and Auxiliary Works'),
    ('69','Electrical and Auxiliary Works'),
    ('70','Electrical and Auxiliary Works'),
    ('71','Plumbing Works'),
    ('72','Mechanical Works'),
    ('73','Mechanical Works'),
    ('74','Mechanical Works'),
    ('75','Plumbing Works'),
    ('76','Plumbing Works'),
    ('77','Mechanical Works'),
    ('78','Fire Protection Works'),
    ('79','Mechanical Works'),
    ('80','Mechanical Works'),
    ('81','Mechanical Works'),
    ('82','Mechanical Works'),
    ('83','Mechanical Works'),
    ('84','Mechanical Works'),
    ('85','Mechanical Works'),
    ('86','Mechanical Works'),
    ('87','Plumbing Works')
) as v(wp_no, trade)
where m.wpm_project_id = 'SLN101' and m.wp_no = v.wp_no
  and (m.trade is null or m.trade = '' or m.trade is distinct from v.trade);

-- Verify: should return 0 rows once every WP is traded.
-- select wp_no, description from wpm_work_packages
-- where wpm_project_id = 'SLN101' and (trade is null or trade = '') order by wp_no;
