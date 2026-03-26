CREATE INDEX IF NOT EXISTS `ps_game_snapshot_idx` ON `price_snapshots` (`game_id`, `snapshot_date`);
CREATE INDEX IF NOT EXISTS `ug_game_idx` ON `user_games` (`game_id`);
CREATE INDEX IF NOT EXISTS `sl_source_started_idx` ON `sync_log` (`source`, `started_at`);
ALTER TABLE `games` ADD COLUMN `hltb_miss_count` integer DEFAULT 0;
