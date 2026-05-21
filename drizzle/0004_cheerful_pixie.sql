DROP INDEX `api_keys_user_provider_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_user_provider_single_idx` ON `api_keys` (`user_id`,`provider`) WHERE "api_keys"."provider" <> 'scraperapi';--> statement-breakpoint
CREATE INDEX `api_keys_user_provider_idx` ON `api_keys` (`user_id`,`provider`);