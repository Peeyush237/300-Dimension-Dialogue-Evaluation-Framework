import './App.css'

function App() {
  const scores = [
    {
      facet: 'Brevity',
      category: 'linguistic',
      score: 4,
      confidence: 0.78,
      reason: 'Responses are concise with minimal filler.',
    },
    {
      facet: 'Collaboration',
      category: 'social',
      score: 5,
      confidence: 0.81,
      reason: 'Turns build on user intent with clear alignment.',
    },
    {
      facet: 'Critical reasoning',
      category: 'cognitive',
      score: 4,
      confidence: 0.74,
      reason: 'Reasoning steps are explicit and coherent.',
    },
    {
      facet: 'Harmfulness',
      category: 'safety',
      score: 5,
      confidence: 0.87,
      reason: 'No unsafe or hostile language detected.',
    },
  ]

  return (
    <div className="page">
      <header className="site-header">
        <div className="mark">
          <span className="mark-square" />
          <span>AHOUM</span>
        </div>
        <nav className="nav-links">
          <button type="button">Pipeline</button>
          <button type="button">Facets</button>
          <button type="button">Reports</button>
        </nav>
        <button className="menu-button" type="button" aria-label="Open menu">
          <span />
          <span />
          <span />
        </button>
      </header>

      <section className="hero">
        <div className="hero-meta">#DESKTOP_PRESENTATION</div>
        <div className="hero-grid">
          <div className="hero-copy">
            <h1>
              <span className="hero-title">A H O U M</span>
              <span className="hero-title outline">EVALUATOR</span>
            </h1>
            <p className="hero-subtitle">
              Scoring multi-turn conversations across 399+ facets with structured evidence,
              confidence, and governance-grade traceability.
            </p>
            <div className="hero-actions">
              <button className="primary" type="button">Start Evaluation</button>
              <button className="ghost" type="button">View Facet Library</button>
            </div>
            <div className="hero-stats">
              <div>
                <span className="stat-value">399+</span>
                <span className="stat-label">facets mapped</span>
              </div>
              <div>
                <span className="stat-value">20-25</span>
                <span className="stat-label">facets per call</span>
              </div>
              <div>
                <span className="stat-value">5k</span>
                <span className="stat-label">scale ready</span>
              </div>
            </div>
          </div>
          <div className="hero-visual">
            <div className="visual-card">
              <div className="visual-tag">LIVE CLUSTER</div>
              <div className="visual-metric">
                <span className="metric-value">12</span>
                <span className="metric-label">parallel batches</span>
              </div>
              <div className="visual-lines">
                <span />
                <span />
                <span />
              </div>
              <div className="visual-footer">Design is not decoration</div>
            </div>
          </div>
        </div>
      </section>

      <section className="statement">
        <div className="statement-inner">
          <span className="statement-tag">#WE_ARE_A</span>
          <h2>
            DESIGNING <span>CLARITY</span>,
            <br />
            BUILDING <span>TRUSTED</span>
            <br />
            CONVERSATION INTELLIGENCE
          </h2>
        </div>
      </section>

      <section className="grid-section">
        <div className="grid-header">
          <h3>Evaluator Console</h3>
          <button className="ghost" type="button">Download Report</button>
        </div>
        <div className="console">
          <div className="console-input">
            <label htmlFor="conversation">Conversation Input</label>
            <textarea
              id="conversation"
              placeholder="user: I need help evaluating a conversation..."
              rows={8}
              readOnly
              defaultValue={`user: I need a faster way to evaluate conversations.\nassistant: We can cluster facets and score in batches.\nuser: Can you show me the results?\nassistant: Here are the top facets with confidence scores.`}
            />
            <div className="console-actions">
              <button className="primary" type="button">Evaluate</button>
              <button className="ghost" type="button">Reset</button>
            </div>
          </div>
          <div className="console-results">
            <div className="results-header">
              <h4>Results Snapshot</h4>
              <span className="pill">avg score 4.3</span>
            </div>
            <div className="results-table">
              {scores.map((row) => (
                <div key={row.facet} className="result-row">
                  <div>
                    <div className="facet-name">{row.facet}</div>
                    <div className="facet-meta">{row.category}</div>
                  </div>
                  <div className={`score score-${row.score}`}>{row.score}</div>
                  <div className="confidence">{row.confidence.toFixed(2)}</div>
                  <div className="reason">{row.reason}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="impact">
        <div className="impact-card">
          <span className="impact-tag">#SYSTEM_SCALE</span>
          <h3>
            5000+ <span>FACETS</span>
          </h3>
          <p>Clustered batching keeps throughput linear with no architectural changes.</p>
          <div className="impact-stats">
            <div>
              <span className="stat-value">200</span>
              <span className="stat-label">async calls</span>
            </div>
            <div>
              <span className="stat-value">0</span>
              <span className="stat-label">redesigns</span>
            </div>
            <div>
              <span className="stat-value">99%</span>
              <span className="stat-label">schema coverage</span>
            </div>
          </div>
        </div>
      </section>

      <section className="pillars">
        <div className="pillar">
          <h4>Strategy</h4>
          <p>Facet classification, difficulty tagging, and measurable anchors.</p>
        </div>
        <div className="pillar">
          <h4>Digital Systems</h4>
          <p>Async LLM batches, validation pipelines, and deterministic outputs.</p>
        </div>
        <div className="pillar">
          <h4>Identity</h4>
          <p>Consistent evaluation language across product, safety, and research.</p>
        </div>
      </section>
    </div>
  )
}

export default App
