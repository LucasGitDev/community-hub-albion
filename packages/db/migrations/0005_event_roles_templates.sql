CREATE TABLE "event_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_roles_name_not_blank" CHECK (length(trim("event_roles"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "event_template_roles" (
	"template_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"slots" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_template_roles_template_id_role_id_pk" PRIMARY KEY("template_id","role_id"),
	CONSTRAINT "event_template_roles_slots_positive" CHECK ("event_template_roles"."slots" > 0)
);
--> statement-breakpoint
CREATE TABLE "event_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"min_party_size" integer NOT NULL,
	"max_party_size" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_templates_party_size" CHECK ("event_templates"."min_party_size" >= 1 and ("event_templates"."max_party_size" is null or "event_templates"."max_party_size" >= "event_templates"."min_party_size"))
);
--> statement-breakpoint
ALTER TABLE "event_template_roles" ADD CONSTRAINT "event_template_roles_template_id_event_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."event_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_template_roles" ADD CONSTRAINT "event_template_roles_role_id_event_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."event_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_roles_name_lower_idx" ON "event_roles" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "event_template_roles_role_idx" ON "event_template_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_templates_name_lower_idx" ON "event_templates" USING btree (lower("name"));--> statement-breakpoint
-- Seed do catálogo (TASK-020): migration roda uma vez por banco, restart não duplica e não sobrescreve edição da staff.
INSERT INTO "event_roles" ("name", "sort_order") VALUES ('Tank', 10), ('Healer', 20), ('DPS Melee', 30), ('DPS Range', 40), ('Support', 50), ('Scout', 60) ON CONFLICT DO NOTHING;
