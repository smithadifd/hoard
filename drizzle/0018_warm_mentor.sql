CREATE TABLE `recommendation_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text DEFAULT 'default' NOT NULL,
	`game_id` integer NOT NULL,
	`bucket` text NOT NULL,
	`reason` text NOT NULL,
	`score` real,
	`shown_at` text DEFAULT (datetime('now')) NOT NULL,
	`accepted_at` text,
	`dismissed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `re_user_game_idx` ON `recommendation_events` (`user_id`,`game_id`);--> statement-breakpoint
CREATE INDEX `re_user_shown_idx` ON `recommendation_events` (`user_id`,`shown_at`);