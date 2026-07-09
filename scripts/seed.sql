-- Seed a demo DuckLake catalog with tables that trigger every analyzer.
--
-- Usage:
--   duckdb < scripts/seed.sql
--
-- Creates:
--   /tmp/ducklake-probe/lake_meta.db     — DuckLake metadata (point .env.local here)
--   /tmp/ducklake-probe/data/            — parquet data files
--
-- After seeding:
--   /audit                                — 4 findings (small-files, snapshot-bloat, partition-skew, orphan-files)
--   analytics.metrics_noisy               — 20+ tiny files (small-files + snapshot-bloat trigger)
--   analytics.events_partitioned          — hot US partition (partition-skew trigger)
--   /tmp/ducklake-probe/data/orphan-*.parquet — orphan file for orphan-files analyzer

INSTALL ducklake;
LOAD ducklake;

-- Fresh probe (delete pre-existing state to make seeding deterministic)
.shell rm -rf /tmp/ducklake-probe && mkdir -p /tmp/ducklake-probe
ATTACH 'ducklake:/tmp/ducklake-probe/lake_meta.db' AS lake (DATA_PATH '/tmp/ducklake-probe/data/');
USE lake;
CREATE SCHEMA app;
CREATE SCHEMA analytics;

-- ================================================================
-- app.users — 50k dim table, one snapshot each for ALTER ops
-- ================================================================
CREATE TABLE app.users AS
SELECT
  i                                                              AS user_id,
  'user_' || i || '@example.com'                                 AS email,
  ['US','GB','DE','FR','IN','BR','JP','AU'][((i % 8) + 1)::INT]  AS country,
  ['free','pro','team','enterprise'][((i % 4) + 1)::INT]         AS plan,
  TIMESTAMP '2024-01-01 00:00:00' + INTERVAL (i * 7) MINUTE      AS signup_ts
FROM range(50000) t(i);

-- Schema-evolution events (for Snapshots pane badges)
ALTER TABLE app.users ADD COLUMN region VARCHAR;
UPDATE app.users SET region = ['us-east','us-west','eu','apac'][((user_id % 4) + 1)::INT];
ALTER TABLE app.users ADD COLUMN is_active BOOLEAN;
ALTER TABLE app.users DROP COLUMN plan;

-- ================================================================
-- app.events — 200k event stream
-- ================================================================
CREATE TABLE app.events AS
SELECT
  i                                                                        AS event_id,
  ((i * 2654435761) % 50000)::BIGINT                                       AS user_id,
  ['click','view','purchase','signup','logout','error'][((i % 6) + 1)::INT] AS event_type,
  TIMESTAMP '2025-01-01 00:00:00' + INTERVAL (i * 3) SECOND                AS ts,
  '{"a":' || (i % 100) || ',"b":"' || (i % 7) || '"}'                      AS payload
FROM range(200000) t(i);

ALTER TABLE app.events ADD COLUMN source VARCHAR;

-- ================================================================
-- app.orders / app.page_views — small demo tables (inline data)
-- ================================================================
CREATE TABLE app.orders(id INT, sku VARCHAR, amount DECIMAL(10,2));
INSERT INTO app.orders VALUES (1,'A',9.99),(2,'B',19.50),(3,'C',4.25),(4,'D',12.00);

CREATE TABLE app.page_views(id INT, url VARCHAR, viewed_at TIMESTAMP);
INSERT INTO app.page_views VALUES
  (1,'/',     TIMESTAMP '2025-01-01 10:00:00'),
  (2,'/home', TIMESTAMP '2025-01-01 10:01:00'),
  (3,'/pricing', TIMESTAMP '2025-01-01 10:02:00'),
  (4,'/docs', TIMESTAMP '2025-01-01 10:03:00'),
  (5,'/blog', TIMESTAMP '2025-01-01 10:04:00');

-- View — exercises the CatalogTree "view" rendering
CREATE VIEW app.recent_pv AS
SELECT * FROM app.page_views WHERE viewed_at > TIMESTAMP '2025-01-01 10:00:00';

-- ================================================================
-- analytics.sessions & analytics.page_views_wide — larger fact tables
-- ================================================================
CREATE TABLE analytics.sessions AS
SELECT
  i                                                                        AS session_id,
  ((i * 2654435761) % 50000)::BIGINT                                       AS user_id,
  TIMESTAMP '2025-01-01 00:00:00' + INTERVAL (i * 60) SECOND               AS started_at,
  TIMESTAMP '2025-01-01 00:00:00' + INTERVAL ((i * 60) + (i % 3600)) SECOND AS ended_at,
  (1 + (i % 50))::INT                                                      AS page_count
FROM range(25000) t(i);

CREATE TABLE analytics.page_views_wide AS
SELECT
  i                                                                        AS pv_id,
  ((i * 1103515245 + 12345) % 25000)::BIGINT                               AS session_id,
  ((i * 2654435761) % 50000)::BIGINT                                       AS user_id,
  '/p/' || (i % 500)                                                       AS url,
  CASE (i % 5) WHEN 0 THEN 'google' WHEN 1 THEN 'twitter' WHEN 2 THEN 'direct' WHEN 3 THEN 'reddit' ELSE 'linkedin' END AS referrer,
  ['Chrome','Safari','Firefox','Edge','Mobile'][((i % 5) + 1)::INT]        AS user_agent,
  TIMESTAMP '2025-01-01 00:00:00' + INTERVAL (i * 2) SECOND                AS ts,
  (500 + (i % 30000))::INT                                                 AS dwell_ms
FROM range(500000) t(i);

-- ================================================================
-- analytics.metrics_noisy — 20+ tiny inserts to trigger small-files
-- AND snapshot-bloat analyzers (>20 snapshots on this table)
-- ================================================================
CREATE TABLE analytics.metrics_noisy(
  metric_id BIGINT, name VARCHAR, value DOUBLE, ts TIMESTAMP
);
BEGIN; INSERT INTO analytics.metrics_noisy SELECT  0*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT  1*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT  2*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT  3*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT  4*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT  5*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT  6*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT  7*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT  8*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT  9*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT 10*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT 11*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT 12*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT 13*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT 14*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT 15*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT 16*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT 17*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT 18*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT 19*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT 20*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT 21*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;
BEGIN; INSERT INTO analytics.metrics_noisy SELECT 22*100+i,'cpu',0.5,TIMESTAMP '2025-01-01'+INTERVAL(i)MINUTE FROM range(100) t(i); COMMIT;

-- ================================================================
-- analytics.events_partitioned — 90% US partition (partition-skew)
-- ================================================================
CREATE TABLE analytics.events_partitioned(
  event_id BIGINT, country VARCHAR, ts TIMESTAMP, payload VARCHAR
);
ALTER TABLE analytics.events_partitioned SET PARTITIONED BY (country);
INSERT INTO analytics.events_partitioned
SELECT i, 'US', TIMESTAMP '2025-01-01' + INTERVAL (i) SECOND, 'p_' || (i % 20)
FROM range(90000) t(i);
INSERT INTO analytics.events_partitioned SELECT i+90000, 'GB', TIMESTAMP '2025-01-01', 'p' FROM range(2000) t(i);
INSERT INTO analytics.events_partitioned SELECT i+92000, 'DE', TIMESTAMP '2025-01-01', 'p' FROM range(2000) t(i);
INSERT INTO analytics.events_partitioned SELECT i+94000, 'FR', TIMESTAMP '2025-01-01', 'p' FROM range(2000) t(i);
INSERT INTO analytics.events_partitioned SELECT i+96000, 'JP', TIMESTAMP '2025-01-01', 'p' FROM range(2000) t(i);
INSERT INTO analytics.events_partitioned SELECT i+98000, 'BR', TIMESTAMP '2025-01-01', 'p' FROM range(2000) t(i);

-- Materialize any inlined data as parquet
CALL ducklake_flush_inlined_data('lake');

-- ================================================================
-- Plant one orphan parquet file (not referenced by any snapshot)
-- to trigger the orphan-files analyzer on /audit.
-- ================================================================
COPY (SELECT 1 AS x) TO '/tmp/ducklake-probe/data/orphan-stray-file.parquet' (FORMAT PARQUET);

-- Report final state
SELECT '---SEED COMPLETE---' AS status;
SELECT sc.schema_name || '.' || tb.table_name AS t,
       COUNT(df.data_file_id) AS files,
       SUM(df.record_count)   AS live_rows
FROM __ducklake_metadata_lake.ducklake_table tb
JOIN __ducklake_metadata_lake.ducklake_schema sc USING(schema_id)
LEFT JOIN __ducklake_metadata_lake.ducklake_data_file df
  ON df.table_id = tb.table_id AND df.end_snapshot IS NULL
WHERE tb.end_snapshot IS NULL
GROUP BY 1 ORDER BY files DESC;

SELECT 'Total snapshots' AS metric, COUNT(*) AS val FROM __ducklake_metadata_lake.ducklake_snapshot;
