ALTER TABLE `games` ADD `steam_playtime_median` real;--> statement-breakpoint
ALTER TABLE `games` ADD `steam_playtime_sample_size` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `steam_playtime_updated_at` text;--> statement-breakpoint
ALTER TABLE `games` ADD `steam_playtime_miss_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `user_games` ADD `playtime_source` text DEFAULT 'hltb' NOT NULL;