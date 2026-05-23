ALTER TABLE `games` ADD `price_history_backfilled_at` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `price_history_miss_count` integer DEFAULT 0;