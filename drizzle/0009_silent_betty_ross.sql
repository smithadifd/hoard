CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`link` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`read_at` integer,
	`dismissed_at` integer
);
--> statement-breakpoint
CREATE INDEX `notif_user_unread_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notif_user_created_idx` ON `notifications` (`user_id`,`created_at`);