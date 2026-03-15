CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`type` text NOT NULL,
	`title` text,
	`content` text,
	`author` text,
	`status` text,
	`priority` text,
	`assignee` text,
	`tags` text DEFAULT '[]',
	`metadata` text DEFAULT '{}',
	`path` text,
	`slug` text,
	`depth` integer DEFAULT 0,
	`child_count` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_parent_id` ON `nodes` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_type` ON `nodes` (`type`);--> statement-breakpoint
CREATE INDEX `idx_author` ON `nodes` (`author`);--> statement-breakpoint
CREATE INDEX `idx_status` ON `nodes` (`status`);--> statement-breakpoint
CREATE INDEX `idx_assignee` ON `nodes` (`assignee`);--> statement-breakpoint
CREATE INDEX `idx_path` ON `nodes` (`path`);--> statement-breakpoint
CREATE INDEX `idx_created_at` ON `nodes` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_depth` ON `nodes` (`depth`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_parent_slug` ON `nodes` (`parent_id`,`slug`);