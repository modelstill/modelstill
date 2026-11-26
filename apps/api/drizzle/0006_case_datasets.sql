CREATE TABLE "case_dataset_versions" (
	"dataset_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"hash" text NOT NULL,
	"parent" integer,
	"row_count" integer NOT NULL,
	"change" jsonb NOT NULL,
	"author" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_dataset_versions_dataset_id_number_pk" PRIMARY KEY("dataset_id","number")
);
--> statement-breakpoint
CREATE TABLE "case_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_rows" (
	"dataset_id" uuid NOT NULL,
	"row_id" text NOT NULL,
	"version" integer NOT NULL,
	"position" integer NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"input" jsonb,
	"expected" jsonb,
	"metadata" jsonb NOT NULL,
	"author" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_rows_dataset_id_row_id_version_pk" PRIMARY KEY("dataset_id","row_id","version")
);
--> statement-breakpoint
ALTER TABLE "case_dataset_versions" ADD CONSTRAINT "case_dataset_versions_dataset_id_case_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."case_datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_datasets" ADD CONSTRAINT "case_datasets_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_rows" ADD CONSTRAINT "case_rows_dataset_id_case_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."case_datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_datasets_task_name" ON "case_datasets" USING btree ("task_id","name");--> statement-breakpoint
CREATE INDEX "case_rows_dataset_version" ON "case_rows" USING btree ("dataset_id","version");