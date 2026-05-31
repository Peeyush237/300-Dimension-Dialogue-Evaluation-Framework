const LIVE_URL = 'https://three00-dimension-dialogue-evaluation.onrender.com/'

const heroStats = [
  { label: 'Facets in dataset', value: '399' },
  { label: 'Facets per LLM call', value: '20–25' },
  { label: 'Scale ready', value: '5000+' },
]

const facetCards = [
  {
    title: 'Personality',
    items: ['Assertiveness', 'Compassion', 'Hesitation', 'Enthusiasm', 'Determinedness', 'Openness'],
  },
  {
    title: 'Linguistic quality',
    items: ['Brevity', 'Sentence structure', 'Spelling accuracy', 'Frankness', 'Concreteness', 'Outspokenness'],
  },
  {
    title: 'Emotional',
    items: ['Joyfulness', 'Warmheartedness', 'Emotionalism', 'Blissfulness', 'Sensitiveness', 'Merriness'],
  },
  {
    title: 'Safety & ethics',
    items: ['Harmfulness', 'Dishonesty', 'Hostility', 'Hatefulness', 'Psychoticism', 'Ethical standards'],
  },
  {
    title: 'Cognitive & reasoning',
    items: [
      'Critical reasoning',
      'Logical sequence',
      'Statistical reasoning',
      'Synthesis of information',
      'Decision-making',
      'Data analysis',
    ],
  },
  {
    title: 'Not scoreable',
    muted: true,
    items: ['FSH level', 'Basophil count', 'Caffeine intake', 'Passport stamps', 'Aura-color perception'],
    note: 'Biological, lifestyle, or esoteric metrics that cannot be inferred from text. We detect and flag these automatically.',
  },
]

const pipelineSteps = [
  {
    step: '1',
    title: 'Input',
    body: 'You paste a conversation or upload JSON. Flexible formats are accepted — for example [{ role: "user", content: "..." }, ...].',
  },
  {
    step: '2',
    title: 'Facet classifier',
    body: 'Loads all 399 facets from the processed CSV. Marks each as scoreable or not scoreable. Groups scoreable facets into semantic clusters using sentence-transformers (all-MiniLM-L6-v2) and KMeans.',
  },
  {
    step: '3',
    title: 'Parallel batch evaluation',
    body: 'Each cluster (~20–25 facets) becomes one LLM call. All clusters run in parallel (asyncio). Model: Groq llama-3.1-8b-instant. Each facet returns score (1–5), confidence, and a one-line reason.',
  },
  {
    step: '4',
    title: 'Streamed output',
    body: 'Results stream live as each cluster completes. The UI shows progress and partial outputs so you are not waiting blindly for the full run.',
  },
  {
    step: '5',
    title: 'Output aggregator',
    body: 'Merges cluster results into one JSON response. Unscoreable facets get score: null and are flagged. Pydantic validates the schema. Downloadable CSV is available.',
  },
  {
    step: '6',
    title: 'Results UI',
    body: 'Color-coded score table (red → yellow → green). Sort by score or confidence. Filter by category. Download the full report as CSV.',
  },
]

const processedColumns = [
  { col: 'facet_name_clean', desc: 'Stripped and normalised facet name' },
  { col: 'scoreable', desc: 'Can this be inferred from conversation text? (true / false)' },
  { col: 'category', desc: 'personality, linguistic, emotion, cognitive, safety, social, biological, spiritual, other' },
  { col: 'evaluation_difficulty', desc: 'easy, medium, or hard' },
  { col: 'requires_full_context', desc: 'Needs the full conversation or only the last turn?' },
  { col: 'score_anchor_low', desc: 'What a score of 1 looks like for this facet' },
  { col: 'score_anchor_high', desc: 'What a score of 5 looks like for this facet' },
  { col: 'cluster_id', desc: 'Which LLM batch this facet belongs to' },
]

const scoreableExamples = [
  { name: 'FSH level', rule: 'biological keyword detected', scoreable: false },
  { name: 'Caffeine intake', rule: 'lifestyle / dietary keyword', scoreable: false },
  { name: 'I Ching hexagram', rule: 'esoteric / spiritual keyword', scoreable: false },
  { name: 'Aura-color perception', rule: 'esoteric keyword', scoreable: false },
  { name: 'Assertiveness', rule: 'personality trait keyword', scoreable: true },
  { name: 'Hostility', rule: 'safety / emotion keyword', scoreable: true },
]

const challenges = [
  {
    title: 'The CSV had 399 rows, not 300',
    problem:
      'The assignment said 300 facets. The actual CSV had 399. Many were not conversation-scoreable — biological metrics, hormone levels, spiritual practices, passport stamp counts.',
    solution:
      'We built an automated classifier to detect and flag non-scoreable facets. They get score: null and reason "not_inferable_from_conversation_text" instead of a hallucinated score. That is more honest than pretending to score a hormone level from text.',
  },
  {
    title: "Can't send 300 facets in one prompt",
    problem:
      'One giant prompt would exceed context limits and break the assignment rule against one-shot prompting. Quality also drops when the model spreads attention across hundreds of unrelated items.',
    solution:
      'KMeans clustering groups facets into batches of ~20–25. Each batch is one focused LLM call on a semantically similar group — not 300 unrelated things at once.',
  },
  {
    title: 'Keeping it fast with many LLM calls',
    problem: '12–15 sequential LLM calls would feel very slow for someone waiting on results.',
    solution:
      'All cluster evaluations run in parallel with Python asyncio. Streaming shows partial results as soon as each cluster finishes.',
  },
  {
    title: '429 Too Many Requests (rate limits)',
    problem: 'Parallel calls can hit provider rate limits (HTTP 429), causing retries and failed batches.',
    solution:
      'Controlled concurrency, request delays, and retry/backoff logic. The system slows down safely instead of failing, then resumes when limits reset.',
  },
  {
    title: 'Getting structured output reliably',
    problem:
      'LLMs sometimes return malformed JSON, markdown backticks, extra commentary, or skip facets from the list.',
    solution:
      'Pydantic schemas enforce strict validation. The prompt demands ONLY valid JSON. Missing facets are flagged by the aggregator instead of silently dropped.',
  },
  {
    title: 'No scoring rubric in the original data',
    problem: 'The CSV only had facet names — no description of what score 1 vs 5 means.',
    solution:
      'We generated score anchor descriptions during preprocessing and inject them into prompts so the model has a concrete rubric, not just a name to guess from.',
  },
  {
    title: 'Making deployment reproducible',
    problem: 'Different machines and environments can produce inconsistent builds and runtime issues.',
    solution:
      'A Docker baseline packages the API and built frontend together for consistent local and cloud deployment.',
  },
]

const techStack = [
  'Python 3.11',
  'FastAPI',
  'Pydantic v2',
  'asyncio',
  'sentence-transformers',
  'scikit-learn KMeans',
  'React + Vite',
  'Docker',
  'Groq LLM API',
]

const scoreScale = [
  { level: '1', meaning: 'Very low / completely absent' },
  { level: '2', meaning: 'Low / minimally present' },
  { level: '3', meaning: 'Moderate / somewhat present' },
  { level: '4', meaning: 'High / clearly present' },
  { level: '5', meaning: 'Very high / strongly dominant' },
]

export default function HomePage({ onGoToEvaluate, onDownloadReport }) {
  return (
    <main className="page">
      <section className="hero">
        <div className="hero-meta">#AHOUM_AI_ML_ASSIGNMENT</div>
        <div className="hero-grid">
          <div className="hero-copy">
            <h1>
              <span className="hero-title">300-DIMENSION</span>
              <span className="hero-title outline">DIALOGUE EVALUATION</span>
            </h1>
            <p className="hero-subtitle">
              Automatically score any conversation across hundreds of quality dimensions — personality,
              linguistics, emotion, safety, reasoning, and more.
            </p>
            <p className="home-lead">
              Most conversation evaluation tools check one or two things — was it polite? was it helpful?
              We go further. This system scores every conversation turn across 300+ distinct facets, using a
              scalable LLM pipeline that runs them in parallel and returns structured scores with confidence
              levels and reasoning.
            </p>
            <p className="home-lead home-lead-accent">
              Paste a conversation or upload JSON, then watch results stream in live as each facet cluster
              completes.
            </p>
            <p className="home-meta-line">
              Built for Ahoum AI &amp; ML Assignment ·{' '}
              <a href={LIVE_URL} target="_blank" rel="noreferrer">
                Live demo
              </a>
            </p>
            <div className="hero-actions">
              <button className="primary" type="button" onClick={onGoToEvaluate}>
                Go to evaluator
              </button>
              <button className="ghost" type="button" onClick={onDownloadReport}>
                Download report
              </button>
            </div>
            <div className="hero-stats">
              {heroStats.map((metric) => (
                <div key={metric.label}>
                  <span className="stat-value">{metric.value}</span>
                  <span className="stat-label">{metric.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="hero-visual">
            <div className="visual-card">
              <div className="visual-tag">STREAMING PIPELINE</div>
              <div className="visual-metric">
                <span className="metric-value">12+</span>
                <span className="metric-label">parallel clusters</span>
              </div>
              <div className="visual-lines">
                <span />
                <span />
                <span />
              </div>
              <div className="visual-footer">JSON upload · live progress · CSV export</div>
            </div>
            <div className="hero-poster">
              <div className="poster-mask" />
              <div className="poster-copy">
                <span>300+</span>
                <p>dimensions per conversation</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="statement">
        <div className="statement-inner">
          <span className="statement-tag">#WHAT_IS_A_FACET</span>
          <h2>
            WHAT IS A <span>FACET</span>?
          </h2>
          <p>
            A facet is a single quality dimension of a conversation — like one specific question being asked
            about the dialogue. Each facet receives a score (1–5), a confidence (0.0–1.0), and a one-line
            reason.
          </p>
        </div>
      </section>

      <section className="gallery home-facet-gallery">
        <div className="gallery-grid home-facet-grid">
          {facetCards.map((card) => (
            <div
              key={card.title}
              className={`gallery-card${card.muted ? ' home-card-muted' : ''}`}
            >
              <span className="gallery-tag">{card.title}</span>
              <h3>{card.title}</h3>
              <p className="home-facet-list">{card.items.join(' · ')}</p>
              {card.note ? <p>{card.note}</p> : null}
            </div>
          ))}
        </div>
        <div className="gallery-metric home-facet-note">
          <p>
            The original dataset contained <strong>399 facets</strong> (not 300 as stated in the assignment).
            After preprocessing, each facet is classified as scoreable or not-scoreable from conversation text
            alone.
          </p>
        </div>
      </section>

      <section className="statement">
        <div className="statement-inner">
          <span className="statement-tag">#PIPELINE</span>
          <h2>
            HOW IT WORKS — <span>THE FULL PIPELINE</span>
          </h2>
        </div>
        <ol className="home-flow">
          {pipelineSteps.map((item, index) => (
            <li key={item.step} className="home-flow-step">
              <div className="home-flow-marker">
                <span>{item.step}</span>
                {index < pipelineSteps.length - 1 ? <span className="home-flow-arrow" aria-hidden="true" /> : null}
              </div>
              <div className="gallery-card home-flow-card">
                <span className="gallery-tag">STEP {item.step}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="impact">
        <div className="impact-card">
          <span className="impact-tag">#SCALABILITY</span>
          <h3>
            BUILT TO SCALE — <span>300 TO 5000 FACETS</span>
          </h3>
          <p>Zero architectural redesign when the facet list grows. Clustering and parallel batches absorb the load.</p>
          <div className="home-compare">
            <div className="gallery-card home-compare-col">
              <span className="gallery-tag">The naive approach</span>
              <h3>Do not do this</h3>
              <ul className="home-list">
                <li>Dump all facets into one giant prompt</li>
                <li>Breaks at ~50 facets (context limit)</li>
                <li>Requires a full rewrite to add more facets</li>
                <li>One-shot prompting — explicitly forbidden</li>
              </ul>
            </div>
            <div className="gallery-card home-compare-col home-compare-good">
              <span className="gallery-tag">Our approach</span>
              <h3>Cluster pipeline</h3>
              <ul className="home-list">
                <li>Embed facets with sentence-transformers (all-MiniLM-L6-v2)</li>
                <li>KMeans groups them into clusters of ~20–25</li>
                <li>One LLM call per cluster, all in parallel</li>
                <li>Add 4700 new facets: re-run the clustering script only</li>
              </ul>
            </div>
          </div>
          <div className="home-math">
            <div>
              <span className="stat-value">300</span>
              <span className="stat-label">facets ÷ 25 per cluster ≈ 12 parallel LLM calls</span>
            </div>
            <div>
              <span className="stat-value">5000</span>
              <span className="stat-label">facets ÷ 25 per cluster ≈ 200 parallel calls (asyncio)</span>
            </div>
          </div>
          <div className="home-callout gallery-card">
            <p>
              <strong>Key insight:</strong> Clustering is automatic — KMeans groups semantically similar facets
              without human labelling. &quot;Assertiveness&quot;, &quot;Dominance&quot;, and &quot;Boldness&quot; land in the same cluster
              naturally. New facets self-organise into the right batch with no manual effort.
            </p>
          </div>
        </div>
      </section>

      <section className="statement">
        <div className="statement-inner">
          <span className="statement-tag">#PREPROCESSING</span>
          <h2>
            HOW WE <span>PROCESSED THE FACETS</span>
          </h2>
          <p>
            The raw dataset was a single-column CSV with 399 facet names and nothing else — no descriptions,
            no scoring rubrics, no categories. We built all of that from scratch.
          </p>
        </div>
        <div className="home-preprocess">
          <div className="gallery-card">
            <span className="gallery-tag">Before (raw CSV)</span>
            <pre className="home-code">Facets{'\n'}──────{'\n'}Risktaking{'\n'}Assertiveness{'\n'}FSH level{'\n'}Caffeine intake (mg/day){'\n'}I Ching hexagram 36 resonance level</pre>
          </div>
          <div className="gallery-card home-table-card">
            <span className="gallery-tag">After (processed CSV)</span>
            <div className="home-table-wrap">
              <table className="home-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {processedColumns.map((row) => (
                    <tr key={row.col}>
                      <td>
                        <code>{row.col}</code>
                      </td>
                      <td>{row.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="home-scoreable-grid">
          {scoreableExamples.map((ex) => (
            <div key={ex.name} className={`gallery-card${ex.scoreable ? '' : ' home-card-muted'}`}>
              <span className="gallery-tag">{ex.scoreable ? 'Scoreable' : 'Not scoreable'}</span>
              <h3>{ex.name}</h3>
              <p>
                → {ex.rule} → <strong>scoreable: {ex.scoreable ? 'True' : 'False'}</strong>
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="statement">
        <div className="statement-inner">
          <span className="statement-tag">#CHALLENGES</span>
          <h2>
            CHALLENGES WE <span>FACED</span> &amp; HOW WE SOLVED THEM
          </h2>
        </div>
        <div className="home-challenges">
          {challenges.map((item) => (
            <details key={item.title} className="gallery-card home-challenge">
              <summary>
                <span className="gallery-tag">Challenge</span>
                <h3>{item.title}</h3>
              </summary>
              <div className="home-challenge-body">
                <p>
                  <strong>Problem:</strong> {item.problem}
                </p>
                <p>
                  <strong>Solution:</strong> {item.solution}
                </p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="gallery home-score-section">
        <div className="statement-inner home-score-intro">
          <span className="statement-tag">#OUTPUT</span>
          <h2>
            WHAT EACH <span>SCORE</span> LOOKS LIKE
          </h2>
        </div>
        <div className="home-score-samples">
          <div className="gallery-card home-score-card">
            <span className="gallery-tag">Scoreable example</span>
            <h3>Assertiveness</h3>
            <p className="home-score-meta">Category: personality · Scoreable: yes</p>
            <div className="home-score-bar" aria-hidden="true">
              <span style={{ width: '80%' }} />
            </div>
            <p>
              <strong>Score:</strong> 4 / 5 · <strong>Confidence:</strong> 0.87
            </p>
            <p className="home-score-reason">
              &quot;The speaker consistently states positions directly and does not hedge excessively, though stops
              short of dominating the exchange.&quot;
            </p>
          </div>
          <div className="gallery-card home-card-muted home-score-card">
            <span className="gallery-tag">Not scoreable</span>
            <h3>FSH level</h3>
            <p className="home-score-meta">Category: biological · Scoreable: no</p>
            <p>
              <strong>Score:</strong> — (null) · <strong>Confidence:</strong> 0.0
            </p>
            <p className="home-score-reason">&quot;Not inferable from conversation text&quot;</p>
          </div>
        </div>
        <div className="pillars home-scale-pillars">
          {scoreScale.map((item) => (
            <div key={item.level} className="pillar">
              <h4>{item.level}</h4>
              <p>{item.meaning}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="statement">
        <div className="statement-inner">
          <span className="statement-tag">#TECH_STACK</span>
          <h2>
            BUILT <span>WITH</span>
          </h2>
          <p className="home-tech-note">
            Uses an open-weights model (llama-3.1-8b-instant) via Groq — within the ≤16B parameter constraint.
          </p>
        </div>
        <div className="pillars home-tech-grid">
          {techStack.map((item) => (
            <div key={item} className="pillar">
              <h4>{item}</h4>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
