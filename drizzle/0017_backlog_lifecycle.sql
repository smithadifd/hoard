ALTER TABLE `user_games` ADD COLUMN `completion_status` text DEFAULT 'unplayed' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_games` ADD COLUMN `backlog_state` text;--> statement-breakpoint
ALTER TABLE `user_games` ADD COLUMN `priority` integer;--> statement-breakpoint
ALTER TABLE `user_games` ADD COLUMN `started_at` text;--> statement-breakpoint
ALTER TABLE `user_games` ADD COLUMN `abandoned_at` text;--> statement-breakpoint
CREATE INDEX `ug_completion_idx` ON `user_games` (`user_id`,`completion_status`);
