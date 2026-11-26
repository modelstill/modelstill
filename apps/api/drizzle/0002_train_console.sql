CREATE TABLE "train_metrics" (
	"run_key" text NOT NULL,
	"step" integer NOT NULL,
	"epoch" double precision,
	"name" text NOT NULL,
	"value" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "train_metrics_run_key_step_name_pk" PRIMARY KEY("run_key","step","name")
);
--> statement-breakpoint
CREATE TABLE "train_runs" (
	"key" text PRIMARY KEY NOT NULL,
	"task_slug" text NOT NULL,
	"base" text NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"manifest" jsonb,
	"attestation" jsonb,
	"final_metrics" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "train_runs_status" CHECK ("train_runs"."status" in ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "train_metrics" ADD CONSTRAINT "train_metrics_run_key_train_runs_key_fk" FOREIGN KEY ("run_key") REFERENCES "public"."train_runs"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "train_runs_task_started" ON "train_runs" USING btree ("task_slug","started_at");