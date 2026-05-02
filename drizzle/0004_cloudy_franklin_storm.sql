ALTER TABLE `games` ADD `source` text DEFAULT 'sync' NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `last_viewed_at` integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `alert_active_idx` ON `price_alerts` (`user_id`,`is_active`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ug_owned_idx` ON `user_games` (`user_id`,`is_owned`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ug_wishlisted_idx` ON `user_games` (`user_id`,`is_wishlisted`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ug_watchlisted_idx` ON `user_games` (`user_id`,`is_watchlisted`);
