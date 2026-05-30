const VALID_ROLES = new Set(['user', 'assistant', 'system'])

const ROLE_ALIASES = {
  user: 'user',
  human: 'user',
  client: 'user',
  customer: 'user',
  participant: 'user',
  speaker: 'user',
  person: 'user',
  assistant: 'assistant',
  ai: 'assistant',
  bot: 'assistant',
  agent: 'assistant',
  model: 'assistant',
  gpt: 'assistant',
  chatbot: 'assistant',
  advisor: 'assistant',
  system: 'system',
}

const CONTENT_KEYS = [
  'content',
  'message',
  'text',
  'body',
  'utterance',
  'value',
  'input',
  'output',
  'reply',
  'response',
  'prompt',
  'answer',
]

const ROLE_KEYS = ['role', 'speaker', 'author', 'from', 'sender', 'type', 'name']

const TURN_CONTAINER_KEYS = [
  'turns',
  'messages',
  'conversation',
  'history',
  'dialogue',
  'chat',
  'utterances',
  'exchanges',
  'transcript',
]

const ID_KEYS = ['conversation_id', 'id', 'session_id', 'chat_id', 'thread_id']

function normalizeRole(raw) {
  if (!raw) {
    return null
  }
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (ROLE_ALIASES[normalized]) {
    return ROLE_ALIASES[normalized]
  }
  if (VALID_ROLES.has(normalized)) {
    return normalized
  }
  return null
}

function firstString(item, keys) {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function extractTurnContent(item) {
  const direct = firstString(item, CONTENT_KEYS)
  if (direct) {
    return direct
  }

  if (item.message && typeof item.message === 'object') {
    const nested = firstString(item.message, CONTENT_KEYS)
    if (nested) {
      return nested
    }
  }

  for (const key of ['parts', 'segments']) {
    const parts = item[key]
    if (Array.isArray(parts)) {
      const texts = []
      for (const part of parts) {
        if (typeof part === 'string' && part.trim()) {
          texts.push(part.trim())
        } else if (part && typeof part === 'object') {
          const partText = firstString(part, CONTENT_KEYS)
          if (partText) {
            texts.push(partText)
          }
        }
      }
      if (texts.length) {
        return texts.join('\n')
      }
    }
  }

  return ''
}

function looksLikeTurn(item) {
  if (!item || typeof item !== 'object') {
    return false
  }
  return Boolean(normalizeRole(firstString(item, ROLE_KEYS)) && extractTurnContent(item))
}

function findTurnList(value, depth = 0) {
  if (depth > 4) {
    return []
  }
  if (Array.isArray(value)) {
    if (value.length && (looksLikeTurn(value[0]) || typeof value[0] === 'string')) {
      return value
    }
    for (const item of value) {
      const found = findTurnList(item, depth + 1)
      if (found.length) {
        return found
      }
    }
  } else if (value && typeof value === 'object') {
    for (const key of TURN_CONTAINER_KEYS) {
      const nested = value[key]
      if (Array.isArray(nested) && nested.length) {
        if (looksLikeTurn(nested[0]) || typeof nested[0] === 'string') {
          return nested
        }
      }
    }
    for (const nested of Object.values(value)) {
      const found = findTurnList(nested, depth + 1)
      if (found.length) {
        return found
      }
    }
  }
  return []
}

function extractConversationId(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  for (const key of ID_KEYS) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return null
}

function extractTurns(payload) {
  if (Array.isArray(payload)) {
    if (payload.length && looksLikeTurn(payload[0])) {
      return payload
    }
    if (payload.length && typeof payload[0] === 'string') {
      return payload
    }
    const nested = findTurnList(payload)
    return nested.length ? nested : []
  }

  if (payload && typeof payload === 'object') {
    if (looksLikeTurn(payload)) {
      return [payload]
    }
    for (const key of TURN_CONTAINER_KEYS) {
      const value = payload[key]
      if (Array.isArray(value) && value.length) {
        if (looksLikeTurn(value[0]) || typeof value[0] === 'string') {
          return value
        }
      }
    }
    const nested = findTurnList(payload)
    if (nested.length) {
      return nested
    }
  }

  return []
}

function parseJsonPayload(payload) {
  const conversationId = extractConversationId(payload)
  const turnsPayload = extractTurns(payload)
  if (!turnsPayload.length) {
    return {
      turns: [],
      conversationId,
      formatDetected: 'json',
      error:
        'JSON does not contain a recognizable conversation. Expected turns/messages/conversation/history.',
    }
  }

  const turns = []
  for (let index = 0; index < turnsPayload.length; index += 1) {
    const item = turnsPayload[index]
    if (typeof item === 'string') {
      if (!item.trim()) {
        continue
      }
      turns.push({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: item.trim(),
      })
      continue
    }
    if (!item || typeof item !== 'object') {
      return {
        turns: [],
        conversationId,
        formatDetected: 'json',
        error: `Turn ${index + 1} must be an object or string.`,
      }
    }
    const role = normalizeRole(firstString(item, ROLE_KEYS))
    const content = extractTurnContent(item)
    if (!role) {
      return {
        turns: [],
        conversationId,
        formatDetected: 'json',
        error: `Turn ${index + 1} is missing a recognizable role.`,
      }
    }
    if (!content) {
      return {
        turns: [],
        conversationId,
        formatDetected: 'json',
        error: `Turn ${index + 1} is missing message content.`,
      }
    }
    turns.push({ role, content })
  }

  if (!turns.length) {
    return {
      turns: [],
      conversationId,
      formatDetected: 'json',
      error: 'No conversation turns found in JSON.',
    }
  }

  return { turns, conversationId, formatDetected: 'json', error: '' }
}

function parseTextFormat(text) {
  const turns = []
  const lines = text.split('\n')
  for (const line of lines) {
    const stripped = line.trim()
    if (!stripped) {
      continue
    }
    const delimiterIndex = stripped.indexOf(':')
    if (delimiterIndex === -1) {
      return {
        turns: [],
        conversationId: null,
        formatDetected: 'text',
        error: 'Text format requires "role: content" on each non-empty line.',
      }
    }
    const roleRaw = stripped.slice(0, delimiterIndex).trim()
    const content = stripped.slice(delimiterIndex + 1).trim()
    const role = normalizeRole(roleRaw)
    if (!role) {
      return {
        turns: [],
        conversationId: null,
        formatDetected: 'text',
        error: `Unknown role "${roleRaw}". Use user, assistant, or system (or common aliases).`,
      }
    }
    if (!content) {
      return {
        turns: [],
        conversationId: null,
        formatDetected: 'text',
        error: 'Every turn must have content after the role.',
      }
    }
    turns.push({ role, content })
  }

  if (!turns.length) {
    return {
      turns: [],
      conversationId: null,
      formatDetected: 'text',
      error: 'No conversation turns found.',
    }
  }

  return { turns, conversationId: null, formatDetected: 'text', error: '' }
}

export function parseConversationInput(raw) {
  const text = raw.trim()
  if (!text) {
    return {
      turns: [],
      conversationId: null,
      formatDetected: 'empty',
      error: 'Input is empty.',
    }
  }

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const payload = JSON.parse(text)
      return parseJsonPayload(payload)
    } catch (err) {
      return {
        turns: [],
        conversationId: null,
        formatDetected: 'json',
        error: `Invalid JSON: ${err instanceof Error ? err.message : 'parse failed'}`,
      }
    }
  }

  return parseTextFormat(text)
}

export function formatTurnPreview(turns, limit = 3) {
  return turns
    .slice(0, limit)
    .map((turn) => `${turn.role}: ${turn.content.slice(0, 80)}${turn.content.length > 80 ? '…' : ''}`)
    .join('\n')
}
