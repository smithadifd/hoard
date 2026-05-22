-- Dedupe existing snapshots so the unique index can be created.
-- For each (game_id, store, snapshot_date) group, keep the row with the
-- lowest price_current. This matches the chart's existing "best price per
-- day" aggregation in queries.ts, so the user-visible behavior is unchanged.
DELETE FROM price_snapshots
WHERE id NOT IN (
  SELECT id FROM price_snapshots ps
  WHERE ps.price_current = (
    SELECT MIN(ps2.price_current) FROM price_snapshots ps2
    WHERE ps2.game_id = ps.game_id
      AND ps2.store = ps.store
      AND ps2.snapshot_date = ps.snapshot_date
  )
  GROUP BY ps.game_id, ps.store, ps.snapshot_date
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ps_game_store_snapshot_idx` ON `price_snapshots` (`game_id`,`store`,`snapshot_date`);
