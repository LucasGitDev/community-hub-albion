CREATE TABLE "voice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" text NOT NULL,
	"guild_id" text,
	"channel_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_sessions_ended_after_started" CHECK ("voice_sessions"."ended_at" is null or "voice_sessions"."ended_at" >= "voice_sessions"."started_at"),
	CONSTRAINT "voice_sessions_heartbeat_after_started" CHECK ("voice_sessions"."last_heartbeat_at" >= "voice_sessions"."started_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "voice_sessions_one_open_per_user_idx" ON "voice_sessions" USING btree ("discord_user_id") WHERE "voice_sessions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "voice_sessions_user_started_idx" ON "voice_sessions" USING btree ("discord_user_id","started_at");--> statement-breakpoint
CREATE INDEX "voice_sessions_channel_window_idx" ON "voice_sessions" USING btree ("channel_id","started_at","ended_at");