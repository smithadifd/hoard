CREATE TABLE `playtime_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`user_id` text DEFAULT 'default' NOT NULL,
	`playtime_minutes` integer NOT NULL,
	`recent_minutes` integer DEFAULT 0,
	`last_played` text,
	`snapshot_date` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pts_game_snapshot_idx` ON `playtime_snapshots` (`game_id`,`snapshot_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `pts_game_user_snapshot_idx` ON `playtime_snapshots` (`game_id`,`user_id`,`snapshot_date`);
