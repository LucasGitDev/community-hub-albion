CREATE TABLE "event_summons" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_summons_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "event_summons" ADD CONSTRAINT "event_summons_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_summons" ADD CONSTRAINT "event_summons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;