import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const demoScores = [
  {
    facet_name: 'Brevity',
    category: 'linguistic',
    score: 4,
    confidence: 0.78,
    reason: 'Responses are concise with minimal filler.',
    scoreable: true,
  },
  {
    facet_name: 'Collaboration',
    category: 'social',
    score: 5,
    confidence: 0.81,
    reason: 'Turns build on user intent with clear alignment.',
    scoreable: true,
  },
  {
    facet_name: 'Critical reasoning',
    category: 'cognitive',
    score: 4,
    confidence: 0.74,
    reason: 'Reasoning steps are explicit and coherent.',
    scoreable: true,
  },
  {
    facet_name: 'Harmfulness',
    category: 'safety',
    score: 5,
    confidence: 0.87,
    reason: 'No unsafe or hostile language detected.',
    scoreable: true,
  },
]

const metrics = [
  { label: 'Facets mapped', value: '399+' },
  { label: 'Facets per call', value: '20-25' },
  { label: 'Scale ready', value: '5k' },
]

const pillars = [
  {
    title: 'Strategy',
    description: 'Facet classification, difficulty tagging, and measurable anchors.',
  },
  {
    title: 'Digital Systems',
    description: 'Async LLM batches, validation pipelines, and deterministic outputs.',
  },
  {
    title: 'Identity',
    description: 'Consistent evaluation language across product, safety, and research.',
  },
]

const defaultConversation = `user: I need a faster way to evaluate conversations.
assistant: We can cluster facets and score in batches.
user: Can you show me the results?
assistant: Here are the top facets with confidence scores.`

const roleSet = new Set(['user', 'assistant', 'system'])

function parseConversation(text) {
  const turns = []
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    const delimiterIndex = line.indexOf(':')
    if (delimiterIndex === -1) {
      return { turns: [], error: 'Each line must use "role: content" format.' }
    }
    const role = line.slice(0, delimiterIndex).trim().toLowerCase()
    const content = line.slice(delimiterIndex + 1).trim()
    if (!roleSet.has(role)) {
      return { turns: [], error: `Unknown role "${role}". Use user, assistant, or system.` }
    }
    if (!content) {
      return { turns: [], error: 'Every turn must have content after the role.' }
    }
    turns.push({ role, content })
  }
  return { turns, error: '' }
}

function csvEscape(value) {
  const stringValue = String(value ?? '')
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

function buildCsv(rows) {
  const header = ['facet_name', 'category', 'score', 'confidence', 'reason', 'scoreable']
  const lines = [header.join(',')]
  rows.forEach((row) => {
    lines.push(
      [
        csvEscape(row.facet_name),
        csvEscape(row.category),
        csvEscape(row.score ?? ''),
        csvEscape(row.confidence ?? ''),
        csvEscape(row.reason),
        csvEscape(row.scoreable),
      ].join(',')
    )
  })
  return lines.join('\n')
}

function App() {
  const evaluateShellRef = useRef(null)
  const [page, setPage] = useState('home')
  const [inputText, setInputText] = useState(defaultConversation)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [splitPercent, setSplitPercent] = useState(50)
  const [isDragging, setIsDragging] = useState(false)

  const activeScores = result?.scores?.length ? result.scores : demoScores
  const scoredFacets = activeScores.filter((row) => typeof row.score === 'number')

  const summary = useMemo(() => {
    const total = activeScores.length
    const scoredCount = scoredFacets.length
    const average = scoredCount
      ? (scoredFacets.reduce((sum, row) => sum + row.score, 0) / scoredCount).toFixed(2)
      : 'n/a'
    const sorted = [...scoredFacets].sort((a, b) => b.score - a.score)
    const highest = sorted.slice(0, 5)
    const lowest = [...sorted].reverse().slice(0, 5)
    return { total, scoredCount, average, highest, lowest }
  }, [activeScores, scoredFacets])

  const handleEvaluate = async () => {
    setError('')
    const { turns, error: parseError } = parseConversation(inputText)
    if (parseError) {
      setError(parseError)
      return
    }
    if (!turns.length) {
      setError('Please add at least one conversation turn.')
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: `ui-${Date.now()}`,
          turns,
        }),
      })
      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || 'Evaluation failed.')
      }
      const data = await response.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error.')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setInputText(defaultConversation)
    setResult(null)
    setError('')
  }

  const handleDownload = () => {
    if (!result?.scores?.length) {
      setError('Run an evaluation before downloading the report.')
      return
    }
    const csv = buildCsv(result.scores)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${result.conversation_id || 'evaluation'}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (!isDragging) {
      return undefined
    }

    const handleMove = (event) => {
      const container = evaluateShellRef.current
      if (!container) {
        return
      }
      const rect = container.getBoundingClientRect()
      const x = event.clientX - rect.left
      const next = (x / rect.width) * 100
      const clamped = Math.min(70, Math.max(30, next))
      setSplitPercent(clamped)
    }

    const handleUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isDragging])

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="mark">
          <span className="mark-square" />
          <span>AHOUM</span>
        </div>
        <nav className="nav-links">
          <button
            type="button"
            className={page === 'home' ? 'nav-active' : ''}
            onClick={() => setPage('home')}
          >
            Home
          </button>
          <button
            type="button"
            className={page === 'evaluate' ? 'nav-active nav-cta' : 'nav-cta'}
            onClick={() => setPage('evaluate')}
          >
            Evaluate now
          </button>
        </nav>
      </header>

      {page === 'home' ? (
        <main className="page">
          <section className="hero">
            <div className="hero-meta">#DESKTOP_PRESENTATION</div>
            <div className="hero-grid">
              <div className="hero-copy">
                <h1>
                  <span className="hero-title">INDEX</span>
                  <span className="hero-title outline">EVALUATOR</span>
                </h1>
                <p className="hero-subtitle">
                  Production-grade conversation scoring across 399+ facets. Structured evidence,
                  confidence, and governance-ready outputs in minutes.
                </p>
                <div className="hero-actions">
                  <button className="primary" type="button" onClick={() => setPage('evaluate')}>
                    Go to evaluator
                  </button>
                  <button className="ghost" type="button" onClick={handleDownload}>
                    Download report
                  </button>
                </div>
                <div className="hero-stats">
                  {metrics.map((metric) => (
                    <div key={metric.label}>
                      <span className="stat-value">{metric.value}</span>
                      <span className="stat-label">{metric.label}</span>
                    </div>
                  ))}
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
                <div className="hero-poster">
                  <div className="poster-mask" />
                  <div className="poster-copy">
                    <span>87+</span>
                    <p>Evaluations shipped</p>
                  </div>
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
              <p>
                Every facet has an anchor, a reason, and a confidence signal. The output is ready
                for policy, product, and research teams.
              </p>
            </div>
          </section>

          <section className="gallery">
            <div className="gallery-grid">
              <div className="gallery-card tall">
                <span className="gallery-tag">#CASE_A</span>
                <h3>Trustworthy evaluations</h3>
                <p>Structured scoring for safety, empathy, and clarity.</p>
              </div>
              <div className="gallery-card wide">
                <span className="gallery-tag">#CASE_B</span>
                <h3>24h coverage</h3>
                <p>Async batch scoring scales to 5000 facets without redesign.</p>
              </div>
              <div className="gallery-card">
                <span className="gallery-tag">#CASE_C</span>
                <h3>Signals that ship</h3>
                <p>Confidence thresholds keep decisions transparent.</p>
              </div>
            </div>
            <div className="gallery-metric">
              <span>104+</span>
              <p>clusters in rotation</p>
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
            {pillars.map((pillar) => (
              <div key={pillar.title} className="pillar">
                <h4>{pillar.title}</h4>
                <p>{pillar.description}</p>
              </div>
            ))}
          </section>
        </main>
      ) : (
        <main
          className={`evaluate-shell${isDragging ? ' dragging' : ''}`}
          ref={evaluateShellRef}
          style={{
            gridTemplateColumns: `${splitPercent}% 12px ${100 - splitPercent}%`,
          }}
        >
          <section className="grid-section" id="console">
            <div className="grid-header">
              <h3>Evaluator Console</h3>
              <button className="ghost" type="button" onClick={handleDownload}>
                Download report
              </button>
            </div>
            <div className="console">
              <div className="console-input">
                <label htmlFor="conversation">Conversation input</label>
                <textarea
                  id="conversation"
                  placeholder="user: I need help evaluating a conversation..."
                  rows={12}
                  value={inputText}
                  onChange={(event) => setInputText(event.target.value)}
                />
                {error ? <div className="console-error">{error}</div> : null}
                <div className="console-actions">
                  <button className="primary" type="button" onClick={handleEvaluate} disabled={loading}>
                    {loading ? 'Evaluating...' : 'Evaluate'}
                  </button>
                  <button className="ghost" type="button" onClick={handleReset} disabled={loading}>
                    Reset
                  </button>
                </div>
                <div className="console-meta">
                  <span>Pipeline: Groq Llama 3.1 8B</span>
                  <span>{result ? 'Live results loaded' : 'Demo mode'}</span>
                </div>
              </div>
            </div>
          </section>

          <div
            className="split-divider"
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(splitPercent)}
            aria-valuemin={30}
            aria-valuemax={70}
            onMouseDown={() => setIsDragging(true)}
          />

          <aside className="results-panel">
            <div className="results-header">
              <h4>Results snapshot</h4>
              <button className="ghost" type="button" onClick={handleDownload}>
                Download report
              </button>
            </div>
            <div className="console-results">
              <div className="results-header">
                <h4>Overview</h4>
                <span className="pill">avg score {summary.average}</span>
              </div>
              <div className="summary">
                <div className="summary-card">
                  <span>Total facets</span>
                  <strong>{summary.total}</strong>
                </div>
                <div className="summary-card">
                  <span>Scored</span>
                  <strong>{summary.scoredCount}</strong>
                </div>
                <div className="summary-card">
                  <span>Nulls</span>
                  <strong>{summary.total - summary.scoredCount}</strong>
                </div>
              </div>
              <div className="results-columns">
                <span>Facet</span>
                <span>Score</span>
                <span>Conf</span>
                <span>Reason</span>
              </div>
              <div className="results-table">
                {activeScores.map((row) => (
                  <div key={row.facet_name} className="result-row">
                    <div>
                      <div className="facet-name">{row.facet_name}</div>
                      <div className="facet-meta">{row.category}</div>
                    </div>
                    <div className={`score score-${row.score ?? 0}`}>{row.score ?? '-'}</div>
                    <div className="confidence">
                      {typeof row.confidence === 'number' ? row.confidence.toFixed(2) : '0.00'}
                    </div>
                    <div className="reason">{row.reason}</div>
                  </div>
                ))}
              </div>
              <div className="top-grid">
                <div>
                  <h5>Top 5 highest</h5>
                  {summary.highest.length ? (
                    summary.highest.map((row) => (
                      <div key={row.facet_name} className="top-item">
                        <span>{row.facet_name}</span>
                        <span>{row.score}</span>
                      </div>
                    ))
                  ) : (
                    <div className="top-empty">No scored facets yet.</div>
                  )}
                </div>
                <div>
                  <h5>Top 5 lowest</h5>
                  {summary.lowest.length ? (
                    summary.lowest.map((row) => (
                      <div key={row.facet_name} className="top-item">
                        <span>{row.facet_name}</span>
                        <span>{row.score}</span>
                      </div>
                    ))
                  ) : (
                    <div className="top-empty">No scored facets yet.</div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </main>
      )}
    </div>
  )
}

export default App
