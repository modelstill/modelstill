ALTER TABLE "eval_runs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "benchmark_name" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "benchmark_version" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "metrics" jsonb;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "primary_metric" text;--> statement-breakpoint
ALTER TABLE "gates" ADD COLUMN "previous_eval_run_id" uuid;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_previous_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("previous_eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE no action ON UPDATE no action;