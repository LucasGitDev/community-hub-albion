CREATE TYPE "public"."nick_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "nick_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"nick" text NOT NULL,
	"status" "nick_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_note" text,
	CONSTRAINT "nick_requests_decided_consistent" CHECK (("nick_requests"."status" = 'pending') = ("nick_requests"."decided_at" is null))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "game_nick" text;--> statement-breakpoint
ALTER TABLE "nick_requests" ADD CONSTRAINT "nick_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nick_requests" ADD CONSTRAINT "nick_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nick_requests_one_pending_per_user_idx" ON "nick_requests" USING btree ("user_id") WHERE "nick_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "nick_requests_status_created_idx" ON "nick_requests" USING btree ("status","created_at");