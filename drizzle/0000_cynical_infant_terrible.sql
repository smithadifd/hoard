CREATE TABLE `game_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_tag_idx` ON `game_tags` (`game_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`steam_app_id` integer NOT NULL,
	`itad_game_id` text,
	`title` text NOT NULL,
	`description` text,
	`short_description` text,
	`header_image_url` text,
	`capsule_image_url` text,
	`release_date` text,
	`developer` text,
	`publisher` text,
	`review_score` integer,
	`review_count` integer,
	`review_description` text,
	`hltb_id` integer,
	`hltb_main` real,
	`hltb_main_extra` real,
	`hltb_completionist` real,
	`hltb_last_updated` text,
	`review_last_updated` text,
	`is_coop` integer DEFAULT false,
	`is_multiplayer` integer DEFAULT false,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_steam_app_id_unique` ON `games` (`steam_app_id`);--> statement-breakpoint
CREATE TABLE `price_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text DEFAULT 'default' NOT NULL,
	`game_id` integer NOT NULL,
	`target_price` real,
	`notify_on_all_time_low` integer DEFAULT true,
	`notify_on_threshold` integer DEFAULT true,
	`is_active` integer DEFAULT true,
	`last_notified_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_user_game_idx` ON `price_alerts` (`user_id`,`game_id`);--> statement-breakpoint
CREATE TABLE `price_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`store` text NOT NULL,
	`price_current` real NOT NULL,
	`price_regular` real NOT NULL,
	`discount_percent` integer DEFAULT 0,
	`currency` text DEFAULT 'USD',
	`url` text,
	`is_historical_low` integer DEFAULT false,
	`historical_low_price` real,
	`deal_score` integer,
	`snapshot_date` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`items_processed` integer DEFAULT 0,
	`error_message` text,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_type_idx` ON `tags` (`name`,`type`);--> statement-breakpoint
CREATE TABLE `user_games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text DEFAULT 'default' NOT NULL,
	`game_id` integer NOT NULL,
	`is_owned` integer DEFAULT false,
	`is_wishlisted` integer DEFAULT false,
	`is_watchlisted` integer DEFAULT false,
	`is_ignored` integer DEFAULT false,
	`playtime_minutes` integer DEFAULT 0,
	`playtime_recent_minutes` integer DEFAULT 0,
	`last_played` text,
	`personal_interest` integer DEFAULT 3,
	`interest_rated_at` text,
	`price_threshold` real,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_game_idx` ON `user_games` (`user_id`,`game_id`);