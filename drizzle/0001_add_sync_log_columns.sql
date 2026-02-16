ALTER TABLE `sync_log` ADD COLUMN `items_attempted` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `sync_log` ADD COLUMN `items_failed` integer DEFAULT 0;