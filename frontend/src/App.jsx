import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTurnPreview, parseConversationInput } from './conversationParser'
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
  { label: 'Facets mapped', value: '399' },
  { label: 'Batch size', value: '20–25' },
  { label: 'Scale ready', value: '5000+' },
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

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

const defaultConversation = `user: I need a faster way to evaluate conversations.
assistant: We can cluster facets and score in batches.
user: Can you show me the results?
assistant: Here are the top facets with confidence scores.`

async function readApiError(response) {
  const text = await response.text()
  try {
    const payload = JSON.parse(text)
    if (typeof payload.detail === 'string') {
      return payload.detail
    }
    if (Array.isArray(payload.detail)) {
      return payload.detail.map((item) => item.msg || JSON.stringify(item)).join(' ')
    }
    return text || 'Request failed.'
  } catch {
    return text || 'Request failed.'
  }
}

async function streamEvaluation(rawText, conversationId, onEvent) {
  const response = await fetch(`${API_BASE}/evaluate/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversationId,
      raw_input: rawText,
    }),
  })
  if (!response.ok) {
    throw new Error(await readApiError(response))
  }
  if (!response.body) {
    throw new Error('Streaming response not available.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() || ''
    for (const chunk of chunks) {
      const lines = chunk.split('\n')
      let eventName = 'message'
      let data = ''
      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.replace('event:', '').trim()
        } else if (line.startsWith('data:')) {
          data += line.replace('data:', '').trim()
        }
      }
      if (!data) {
        continue
      }
      let payload
      try {
        payload = JSON.parse(data)
      } catch {
        payload = { detail: data }
      }
      onEvent(eventName, payload)
    }
  }
}

function createLoadedFile(name, rawText) {
  const parsed = parseConversationInput(rawText)
  return {
    id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    rawText,
    parsedTurns: parsed.turns,
    parseError: parsed.error,
    formatDetected: parsed.formatDetected,
    conversationId: parsed.conversationId,
    result: null,
    status: parsed.error ? 'invalid' : 'ready',
    error: parsed.error,
  }
}

function csvEscape(value) {
  const stringValue = String(value ?? '')
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

function sortFacetScores(rows) {
  return [...rows].sort((a, b) => {
    const aScored = typeof a.score === 'number'
    const bScored = typeof b.score === 'number'
    if (aScored !== bScored) {
      return aScored ? -1 : 1
    }
    if (aScored && bScored && a.score !== b.score) {
      return b.score - a.score
    }
    return a.facet_name.localeCompare(b.facet_name)
  })
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
  const fileInputRef = useRef(null)
  const streamResetRef = useRef(null)
  const [page, setPage] = useState('home')
  const [inputText, setInputText] = useState(defaultConversation)
  const [loadedFiles, setLoadedFiles] = useState([])
  const [activeFileId, setActiveFileId] = useState(null)
  const [batchProgress, setBatchProgress] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [streamState, setStreamState] = useState('idle')
  const [splitPercent, setSplitPercent] = useState(50)
  const [isDragging, setIsDragging] = useState(false)

  const inputPreview = useMemo(() => parseConversationInput(inputText), [inputText])
  const activeFile = loadedFiles.find((file) => file.id === activeFileId) ?? null
  const displayResult = activeFile?.result ?? result
  const activeScores = displayResult?.scores?.length ? displayResult.scores : demoScores
  const sortedScores = useMemo(() => sortFacetScores(activeScores), [activeScores])
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

  const evaluateRawInput = async (rawText, conversationId) => {
    const response = await fetch(`${API_BASE}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId,
        raw_input: rawText,
      }),
    })
    if (!response.ok) {
      throw new Error(await readApiError(response))
    }
    return response.json()
  }

  const handleEvaluate = async () => {
    setError('')
    setBatchProgress('')
    if (inputPreview.error) {
      setError(inputPreview.error)
      return
    }
    if (!inputPreview.turns.length) {
      setError('Please add at least one conversation turn.')
      return
    }
    setLoading(true)
    setStreamState('running')
    try {
      const conversationId = inputPreview.conversationId || `ui-${Date.now()}`
      let finalResult = null
      await streamEvaluation(inputText, conversationId, (event, payload) => {
        if (event === 'status') {
          const stage = payload.stage || 'working'
          const totalClusters = payload.total_clusters
          if (stage === 'scoring' && totalClusters) {
            setBatchProgress(`Scoring ${totalClusters} clusters...`)
          } else {
            setBatchProgress(`Status: ${stage}`)
          }
        } else if (event === 'progress') {
          setBatchProgress(`Scored ${payload.completed}/${payload.total} clusters...`)
        } else if (event === 'complete') {
          finalResult = payload
          setStreamState('complete')
          if (streamResetRef.current) {
            clearTimeout(streamResetRef.current)
          }
          streamResetRef.current = setTimeout(() => {
            setStreamState('idle')
          }, 5000)
        } else if (event === 'error') {
          throw new Error(payload.detail || 'Streaming evaluation failed.')
        }
      })
      if (finalResult) {
        setResult(finalResult)
        setActiveFileId(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error.')
      setStreamState('idle')
    } finally {
      setLoading(false)
    }
  }

  const handleEvaluateAll = async () => {
    const queue = loadedFiles.filter((file) => file.status !== 'invalid')
    if (!queue.length) {
      setError('Upload at least one valid JSON conversation file.')
      return
    }
    setError('')
    setLoading(true)
    let completed = 0
    for (const file of queue) {
      setBatchProgress(`Evaluating ${completed + 1}/${queue.length}: ${file.name}`)
      setLoadedFiles((current) =>
        current.map((item) =>
          item.id === file.id ? { ...item, status: 'evaluating', error: '' } : item
        )
      )
      try {
        const data = await evaluateRawInput(file.rawText, file.conversationId || file.name)
        setLoadedFiles((current) =>
          current.map((item) =>
            item.id === file.id
              ? { ...item, status: 'done', result: data, error: '' }
              : item
          )
        )
        setActiveFileId(file.id)
        setResult(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unexpected error.'
        setLoadedFiles((current) =>
          current.map((item) =>
            item.id === file.id ? { ...item, status: 'failed', error: message } : item
          )
        )
      }
      completed += 1
    }
    setBatchProgress(`Finished ${completed}/${queue.length} files.`)
    setLoading(false)
  }

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) {
      return
    }
    setError('')
    const additions = []
    for (const file of files) {
      const rawText = await file.text()
      additions.push(createLoadedFile(file.name, rawText))
    }
    setLoadedFiles((current) => [...current, ...additions])
    if (additions.length === 1) {
      setInputText(additions[0].rawText)
      setActiveFileId(additions[0].id)
    } else if (additions.length > 1 && !activeFileId) {
      setActiveFileId(additions[0].id)
      setInputText(additions[0].rawText)
    }
    event.target.value = ''
  }

  const handleSelectLoadedFile = (fileId) => {
    const selected = loadedFiles.find((file) => file.id === fileId)
    if (!selected) {
      return
    }
    setActiveFileId(fileId)
    setInputText(selected.rawText)
    setError(selected.error || '')
  }

  const handleReset = () => {
    setInputText(defaultConversation)
    setResult(null)
    setLoadedFiles([])
    setActiveFileId(null)
    setBatchProgress('')
    setError('')
  }

  const handleDownload = () => {
    const exportResult = displayResult
    if (!exportResult?.scores?.length) {
      setError('Run an evaluation before downloading the report.')
      return
    }
    const csv = buildCsv(sortFacetScores(exportResult.scores))
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${exportResult.conversation_id || 'evaluation'}.csv`
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
                  Production-grade conversation scoring across 399 facets. Now with IDE-export
                  JSON upload, async batch evaluation, and governance-ready evidence.
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
                <h3>IDE-export ready</h3>
                <p>Upload JSON exports from your workflow and score conversations in batch.</p>
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
                <div className="input-toolbar">
                  <label htmlFor="conversation">Conversation input</label>
                  <div className="input-toolbar-actions">
                    <input
                      ref={fileInputRef}
                      id="conversation-files"
                      className="file-input"
                      type="file"
                      accept=".json,application/json"
                      multiple
                      onChange={handleFileUpload}
                    />
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading}
                    >
                      Upload JSON
                    </button>
                  </div>
                </div>
                <p className="input-help">
                  Paste plain text (<code>role: message</code>) or upload JSON exports from other
                  tools and IDE workflows. Non-conversation input is rejected before scoring.
                </p>
                <textarea
                  id="conversation"
                  placeholder={'Plain text:\nuser: Hello\nassistant: Hi there\n\nJSON:\n{"messages":[{"role":"user","content":"Hello"}]}'}
                  rows={12}
                  value={inputText}
                  onChange={(event) => {
                    setInputText(event.target.value)
                    setActiveFileId(null)
                  }}
                />
                {!inputPreview.error && inputPreview.turns.length ? (
                  <div className="parse-preview">
                    <span className="parse-preview-label">
                      Parsed {inputPreview.turns.length} turns ({inputPreview.formatDetected})
                    </span>
                    <pre>{formatTurnPreview(inputPreview.turns)}</pre>
                  </div>
                ) : null}
                {loadedFiles.length ? (
                  <div className="loaded-files">
                    <div className="loaded-files-header">
                      <span>{loadedFiles.length} loaded file(s)</span>
                      {loadedFiles.length > 1 ? (
                        <button
                          className="ghost"
                          type="button"
                          onClick={handleEvaluateAll}
                          disabled={loading}
                        >
                          Evaluate all
                        </button>
                      ) : null}
                    </div>
                    <div className="loaded-files-list">
                      {loadedFiles.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          className={`loaded-file${activeFileId === file.id ? ' active' : ''}`}
                          onClick={() => handleSelectLoadedFile(file.id)}
                        >
                          <span className="loaded-file-name">{file.name}</span>
                          <span className={`loaded-file-status status-${file.status}`}>
                            {file.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {batchProgress ? <div className="console-meta">{batchProgress}</div> : null}
                {streamState !== 'idle' ? (
                  <div className={`stream-status stream-${streamState}`}>
                    {streamState === 'running' ? (
                      <span className="stream-indicator">
                        Streaming evaluation
                        <span className="stream-dots" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                      </span>
                    ) : (
                      <span className="stream-complete">Evaluation complete</span>
                    )}
                  </div>
                ) : null}
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
                  <span>{displayResult ? 'Live results loaded' : 'Demo mode'}</span>
                </div>
                <div className="console-meta">
                  <span>
                    Demo run: evaluating only a few clusters to show the workflow. Full runs take
                    longer and can hit Groq free-tier limits.
                  </span>
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
                {sortedScores.map((row) => (
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
