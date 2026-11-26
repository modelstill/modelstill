CREATE DATABASE IF NOT EXISTS modelstill;

CREATE TABLE IF NOT EXISTS modelstill.serving_events
(
    ts DateTime64(3, 'UTC'),
    task LowCardinality(String),
    deployment_id String,
    request_hash String,
    mode LowCardinality(String),
    served_from LowCardinality(String),
    deferred Bool,
    reason LowCardinality(Nullable(String)),
    confidence Nullable(Float64),
    student_model LowCardinality(Nullable(String)),
    model_match Nullable(Bool),
    student_output Nullable(String),
    cloud_model LowCardinality(Nullable(String)),
    cloud_output Nullable(String),
    student_ms Nullable(Float64),
    cloud_ms Nullable(Float64),
    student_cost_usd Nullable(Float64),
    cloud_cost_usd Nullable(Float64)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (task, ts);

CREATE TABLE IF NOT EXISTS modelstill.canary_results
(
    ts DateTime64(3, 'UTC'),
    task LowCardinality(String),
    provider LowCardinality(String),
    item_hash String,
    expected_hash String,
    got_hash String,
    pass Bool
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (task, provider, ts);

CREATE TABLE IF NOT EXISTS modelstill.canary_runs
(
    ts DateTime64(3, 'UTC'),
    run_id String,
    task LowCardinality(String),
    provider LowCardinality(String),
    benchmark_version String,
    items UInt32,
    passed UInt32,
    pass_rate Float64,
    low Float64,
    high Float64,
    floor Float64,
    previous_run_id Nullable(String),
    difference Nullable(Float64),
    difference_low Nullable(Float64),
    difference_high Nullable(Float64),
    alerts Array(LowCardinality(String))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (task, provider, ts);

CREATE TABLE IF NOT EXISTS modelstill.watch_runs
(
    ts DateTime64(3, 'UTC'),
    run_id String,
    task LowCardinality(String),
    provider LowCardinality(String),
    baseline_run_id String,
    baseline_ts DateTime64(3, 'UTC'),
    canary_items Nullable(UInt32),
    canary_passed Nullable(UInt32),
    canary_baseline_passed Nullable(UInt32),
    canary_pass_rate Nullable(Float64),
    canary_low Nullable(Float64),
    canary_high Nullable(Float64),
    canary_floor Nullable(Float64),
    canary_difference Nullable(Float64),
    canary_difference_low Nullable(Float64),
    canary_difference_high Nullable(Float64),
    canary_mcnemar_p Nullable(Float64),
    prompts UInt32,
    failed UInt32,
    answers_changed UInt32,
    stable_changed UInt32,
    served_models Array(String),
    logprob_prompts UInt32,
    logprob_shift Nullable(Float64),
    logprob_noise Nullable(Float64),
    logprob_excess Nullable(Float64),
    logprob_excess_low Nullable(Float64),
    logprob_excess_high Nullable(Float64),
    logprob_p Nullable(Float64),
    alpha Float64,
    critical_shift Float64,
    max_changed Float64,
    level LowCardinality(String),
    alerts Array(LowCardinality(String)),
    fallback Bool
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (task, provider, ts);
