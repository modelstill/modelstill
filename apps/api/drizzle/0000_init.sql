CREATE TYPE "public"."item_source" AS ENUM('langfuse', 'rebuild', 'gateway', 'golden');--> statement-breakpoint
CREATE TYPE "public"."review_kind" AS ENUM('label', 'student_disagreement', 'ppi_sample');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('none', 'queued', 'accepted', 'corrected');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."serving_mode" AS ENUM('off', 'shadow', 'serve');--> statement-breakpoint
CREATE TYPE "public"."split_name" AS ENUM('train', 'val', 'calib', 'gold');--> statement-breakpoint
CREATE TABLE "adapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"training_run_id" uuid NOT NULL,
	"path" text NOT NULL,
	"served_name" text NOT NULL,
	"train_dtype" text NOT NULL,
	"serve_dtype" text NOT NULL,
	"metrics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adapters_path_unique" UNIQUE("path"),
	CONSTRAINT "adapters_served_name_unique" UNIQUE("served_name")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sent_to" text,
	"acked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canary_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"passed" integer NOT NULL,
	"total" integer NOT NULL,
	"low" double precision NOT NULL,
	"high" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"input" jsonb NOT NULL,
	"source" "item_source" NOT NULL,
	"provenance" jsonb NOT NULL,
	"teacher_outputs" jsonb NOT NULL,
	"agreement" boolean,
	"review_state" "review_state" DEFAULT 'none' NOT NULL,
	"final_output_hash" text,
	"final_output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"adapter_id" uuid,
	"mode" "serving_mode" DEFAULT 'off' NOT NULL,
	"student_model" text,
	"shadow_sample" double precision DEFAULT 0.1 NOT NULL,
	"threshold" double precision,
	"target_error" double precision NOT NULL,
	"active_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_version_id" uuid NOT NULL,
	"adapter_id" uuid,
	"cloud_alias" text,
	"dataset_id" uuid NOT NULL,
	"split" "split_name" NOT NULL,
	"judge_model" text NOT NULL,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_scores" (
	"eval_run_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"output" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"judge_score" double precision,
	"human_score" double precision,
	CONSTRAINT "eval_scores_eval_run_id_input_hash_pk" PRIMARY KEY("eval_run_id","input_hash")
);
--> statement-breakpoint
CREATE TABLE "gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_version_id" uuid NOT NULL,
	"eval_run_id" uuid NOT NULL,
	"previous_adapter_id" uuid,
	"passed" boolean NOT NULL,
	"checks" jsonb NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "review_kind" NOT NULL,
	"reviewer" text NOT NULL,
	"verdict" text NOT NULL,
	"corrected_output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "splits" (
	"dataset_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"input_hash" text NOT NULL,
	"split" "split_name" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "splits_dataset_id_version_input_hash_pk" PRIMARY KEY("dataset_id","version","input_hash")
);
--> statement-breakpoint
CREATE TABLE "step_cache" (
	"step_key_hash" text PRIMARY KEY NOT NULL,
	"output_ref" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot_hash" text NOT NULL,
	"spec" jsonb NOT NULL,
	"git_sha" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"owner" text NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "training_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_version_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"split_version" integer NOT NULL,
	"manifest_hash" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"seed" integer NOT NULL,
	"base" text NOT NULL,
	"trl_version" text NOT NULL,
	"transformers_version" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"modal_call_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adapters" ADD CONSTRAINT "adapters_training_run_id_training_runs_id_fk" FOREIGN KEY ("training_run_id") REFERENCES "public"."training_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canary_runs" ADD CONSTRAINT "canary_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_items" ADD CONSTRAINT "dataset_items_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_task_version_id_task_versions_id_fk" FOREIGN KEY ("task_version_id") REFERENCES "public"."task_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_adapter_id_adapters_id_fk" FOREIGN KEY ("adapter_id") REFERENCES "public"."adapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_task_version_id_task_versions_id_fk" FOREIGN KEY ("task_version_id") REFERENCES "public"."task_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_adapter_id_adapters_id_fk" FOREIGN KEY ("adapter_id") REFERENCES "public"."adapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_scores" ADD CONSTRAINT "eval_scores_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_task_version_id_task_versions_id_fk" FOREIGN KEY ("task_version_id") REFERENCES "public"."task_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_previous_adapter_id_adapters_id_fk" FOREIGN KEY ("previous_adapter_id") REFERENCES "public"."adapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_item_id_dataset_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."dataset_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "splits" ADD CONSTRAINT "splits_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_versions" ADD CONSTRAINT "task_versions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_task_version_id_task_versions_id_fk" FOREIGN KEY ("task_version_id") REFERENCES "public"."task_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_runs" ADD CONSTRAINT "training_runs_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_items_input" ON "dataset_items" USING btree ("dataset_id","input_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "task_versions_hash" ON "task_versions" USING btree ("task_id","snapshot_hash");