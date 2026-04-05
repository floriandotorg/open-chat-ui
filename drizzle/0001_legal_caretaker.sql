CREATE TABLE `system_prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `system_prompts_user_idx` ON `system_prompts` (`user_id`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `system_prompt_id` text REFERENCES system_prompts(id);--> statement-breakpoint
ALTER TABLE `conversations` ADD `container` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `active_branches` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `images` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `files` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `tool_calls` text;--> statement-breakpoint
CREATE INDEX `messages_parent_idx` ON `messages` (`parent_id`);--> statement-breakpoint
UPDATE `messages` SET `parent_id` = (
  SELECT m2.id FROM `messages` m2
  WHERE m2.conversation_id = messages.conversation_id
    AND m2.created_at < messages.created_at
  ORDER BY m2.created_at DESC
  LIMIT 1
);
