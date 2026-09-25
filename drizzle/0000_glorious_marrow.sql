CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`spotify_id` text NOT NULL,
	`uri` text NOT NULL,
	`name` text NOT NULL,
	`artist` text NOT NULL,
	`album` text NOT NULL,
	`image_url` text,
	`duration_ms` integer NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_suggestions_spotify_id_status` ON `suggestions` (`spotify_id`,`status`);--> statement-breakpoint
CREATE TABLE `votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`suggestion_id` integer NOT NULL,
	`voter_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`suggestion_id`) REFERENCES `suggestions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_votes_suggestion_voter` ON `votes` (`suggestion_id`,`voter_id`);