-- Floor Plan pins — direction/POV capture (18-item list, Batch E)
-- ------------------------------------------------------------------------------
-- A pin marks WHERE a photo/panorama/3D-scan was taken; direction_deg records
-- which way the camera was FACING, so the Floor Plan view can draw a cone
-- showing field of view, not just a dot.
--
-- Nullable, no default: a pin with no recorded direction is a perfectly valid
-- pin (older pins, or one placed without dragging out a direction) — it just
-- has no cone drawn. Degrees, 0-360, matching standard screen/compass
-- convention (0 = up/north on the plan image, clockwise) — the SAME
-- convention `atan2` on screen-space vectors naturally produces once negated
-- for screen Y being flipped, so the app's direction math and this column
-- agree without a stored offset.
--
-- Idempotent; folded into supabase-schema.sql.

alter table floor_plan_pins add column if not exists direction_deg double precision;

comment on column floor_plan_pins.direction_deg is 'Camera facing direction in degrees, 0-360 clockwise from up on the plan image. NULL = no direction recorded (valid).';
