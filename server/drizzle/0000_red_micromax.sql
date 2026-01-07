CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`layout_id` text,
	`markers` text,
	`created_at` integer,
	FOREIGN KEY (`layout_id`) REFERENCES `layouts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `layouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`description` text,
	`classifier` text,
	`mqtt_url` text,
	`p1_x` real,
	`p1_y` real,
	`p2_x` real,
	`p2_y` real,
	`ref_dist_mm` real,
	`scale` text DEFAULT 'HO',
	`updated_at` integer,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'user',
	`profile` text,
	`mqtt_broker` text DEFAULT 'ws://localhost:8083/mqtt',
	`created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);