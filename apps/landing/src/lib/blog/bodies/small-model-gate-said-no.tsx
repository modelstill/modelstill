import { Code, Docs, DocsCard, IntervalChart, Note, Post } from "@/components/blog/body-kit";

export const body = (
  <>
    <p>
      We run a production task that extracts the technologies named in job postings. A cloud model does it today. We wanted to replace it with a small model we own: no per-call bill, no provider changing the model under us.
    </p>
    <p>
      We used ModelStill to decide. After five fine-tuning runs and one open model, the gate said no. This post shows the numbers, what they cost, and what we would do the same way again.
    </p>

    <h2>The set-up</h2>
    <ul>
      <li>
        <strong>Gold set:</strong> 307 postings whose answers people checked, built the way <Post slug="golden-dataset-from-production-traces">the golden dataset post</Post> describes.
      </li>
      <li>
        <strong>Metric:</strong> pooled F1 over the technologies found in all postings, with a bootstrap interval, and a per-posting score for the paired comparison.
      </li>
      <li>
        <strong>Baseline:</strong> the cloud model we run today, accepted as the baseline on that set.
      </li>
      <li>
        <strong>Candidates:</strong> five LoRA fine-tunes of Qwen3 4B and 8B, trained on 2.4k to 13.5k recorded production answers, and an open Qwen3.6-35B-A3B used as it is, with thinking off.
      </li>
    </ul>
    <p>
      The steps follow the <Docs doc="/guides/distil-a-task">distillation guide</Docs>: record calls, label them, leave the gold set out of training, train, then score the student on the gold set against the cloud baseline.
    </p>

    <h2>What the averages said</h2>
    <p>The cloud model scored 0.845 [0.814, 0.875]. The five fine-tuning runs scored 0.775, 0.788, 0.791, 0.793 and 0.811. The open model scored 0.806.</p>
    <IntervalChart
      caption="Pooled F1 on the 307-posting gold set, with 95% intervals."
      min={0.74}
      max={0.89}
      rows={[
        { label: "Cloud model (baseline)", value: 0.845, low: 0.814, high: 0.875, tone: "base" },
        { label: "Best fine-tuning run", value: 0.811, low: 0.77, high: 0.849, tone: "candidate" },
        { label: "Open model, as it is", value: 0.806, low: 0.756, high: 0.85, tone: "candidate" },
      ]}
    />
    <p>
      Look only at this chart and you could argue either way. The best run is 0.034 behind, but its interval overlaps the baseline&apos;s. &quot;Within noise&quot; is a tempting reading. It is the wrong one.
    </p>

    <h2>What the paired comparison said</h2>
    <p>
      Overlapping intervals on two separate scores do not mean two models are equal. Each interval carries the spread from easy and hard postings. A paired comparison scores both models on the same posting, takes the difference, and removes that spread.
    </p>
    <IntervalChart
      caption="Candidate minus cloud model, per posting, with 95% bootstrap intervals. The dashed line is no difference."
      min={-0.06}
      max={0.02}
      reference={0}
      rows={[
        { label: "Best fine-tuning run: 13 fixed, 48 broken", value: -0.022, low: -0.034, high: -0.009, tone: "candidate" },
        { label: "Open model: 20 fixed, 42 broken", value: -0.03, low: -0.05, high: -0.011, tone: "candidate" },
      ]}
    />
    <p>
      Both intervals sit wholly below zero, so the verdict for both is <Code>worse</Code>. The best fine-tuning run fixed 13 postings and broke 48. The open model fixed 20 and broke 42. The gate&apos;s regression check reads the lower bound: any allowed regression smaller than 0.034 fails the best run, and smaller than 0.050 fails the open model.
    </p>

    <h2>What it cost</h2>
    <p>
      Training cost us nothing in cash: each run took about 5 to 7 hours on a 3-GPU workstation we already own. Relabelling the training data with a newer cloud model cost about $1 in API calls.
    </p>
    <p>
      Relabelling with the newer cloud model and adding more data did help: the student copied the teacher more closely. It did not close the gap on the gold set.
    </p>

    <h2>The decision</h2>
    <p>
      We kept the cloud model. Instead of replacing it, we gate its changes: a prompt edit or a provider model update runs on the same 307 postings and is compared with the accepted baseline before it ships.
    </p>
    <p>
      The small model is not finished for good. If a later candidate passes the same gate, it can take over. Until then, the cloud model stays.
    </p>

    <h2>What we would do the same way again</h2>
    <p>
      <strong>Measure the noise floor first.</strong> Ask the current model the same questions twice and see how often it agrees with itself. That bounds how close any candidate can look, and stops you chasing a gap that is only noise. See <Docs doc="/guides/noise-floor">Measure a noise floor</Docs>.
    </p>
    <p>
      <strong>Compare in the view production stores.</strong> Two answers can differ as text and store the same thing, or look alike and store different things. Score what your system keeps, not the raw reply. <Code>modelstill swap</Code> takes a <Code>--view</Code> that maps answers before scoring; see <Docs doc="/guides/model-swap">Check a model swap</Docs>.
    </p>
    <p>
      <strong>Change one thing per run.</strong> We did not, once. Our fifth run changed the training data and also dropped gradient accumulation. When its score moved, we could not say which change moved it, and that run taught us less than it cost.
    </p>
    <p>
      <strong>Trust the paired comparison over the average.</strong> An average 0.034 lower, with overlapping intervals, invites a debate. 48 broken postings against 13 fixed ends it. That is the regression you would ship without seeing it.
    </p>
    <Note>
      These numbers come from one task and one gold set. They say nothing general about small models. They say that this candidate, on this task, was worse than the model it would replace, and the gate caught it.
    </Note>
    <div className="docs-cards">
      <DocsCard doc="/guides/distil-a-task" title="Distil a task">
        Record, label, train and serve a small student behind the gate.
      </DocsCard>
      <DocsCard doc="/guides/train-on-a-gpu-host" title="Train on a GPU host">
        Train on a machine you own instead of a cloud GPU.
      </DocsCard>
    </div>
  </>
);
