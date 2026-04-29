import { useState, useRef, useEffect, useCallback } from 'react'
import { 
  Send, ImagePlus, Loader2, Bot, User, Sparkles, Plus, Trash2, 
  MessageSquare, ChevronRight, X, Image as ImageIcon, Wrench,
  ToggleLeft, ToggleRight, StopCircle, Mic, PhoneCall, PhoneOff, RefreshCw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ToolPicker } from '@/components/ToolPicker'
import { ToolCallMessage, type ToolCall } from '@/components/ToolCallMessage'
import { MessageContent } from '@/components/MessageContent'
import { cn } from '@/lib/utils'
import { 
  streamChatCompletion, 
  createChatCompletionRaw,
  listModels, 
  listSessions,
  getSession,
  createSession,
  deleteSession,
  addMessageToSession,
  autoTitleSession,
  listMcpTools,
  executeMcpTool,
  BUILTIN_SERVER_ID,
  generateImage,
  storeImage as cacheImage,
  storeMedia,
  normalizeContentMedia,
  normalizeSessionMessageMedia,
  resolveMediaUrl,
  ApiError,
  type ChatMessage as ApiChatMessage,
  type SessionListItem,
  type McpTool,
  type Model,
} from '@/api/client'
import { loadSettings, updateSetting, saveSettings, IMAGE_SIZE_OPTIONS, DEFAULT_GENERATION_PARAMS, type ImageSize, type GenerationParamsDraft, type GenerationParamsPayload } from '@/stores/settings'
import {
  buildUserPayload,
  findNonDataImageUrls,
  toApiMessage,
} from './agentPlaygroundPayload'
import {
  applyAutoTitleToSessions,
  createDeferredAutoTitleCandidate,
  flushDeferredAutoTitle,
} from './sessionAutoTitle'
import {
  applyThinkingChunk,
  createThinkingStreamState,
  toDisplayContent,
  toFinalContent,
} from './agentThinkingContent'
import { compressImageFileForUpload, fileToDataUrl } from './imageUpload'

// Content can be a string or array of content parts (multimodal)
type ContentPart = 
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { url?: string; data?: string; format?: string } }
  | { type: 'audio'; audio: { url?: string; data?: string; format?: string } }

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | ContentPart[] | null
  images?: string[]
  requestImages?: string[]
  toolCalls?: ToolCall[]
  toolCallId?: string
  model?: string
  generationParams?: GenerationParamsPayload
  createdAt: Date
}

// Helper to extract text from content (string or multimodal array)
function getTextContent(content: string | ContentPart[] | null): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('')
}

// Helper to extract images from multimodal content
function getImageUrls(content: string | ContentPart[] | null): string[] {
  if (!content || typeof content === 'string') return []
  return content
    .filter((p): p is { type: 'image_url'; image_url: { url: string } } => p.type === 'image_url')
    .map(p => resolveMediaUrl(p.image_url.url))
}

function getAudioUrls(content: string | ContentPart[] | null): string[] {
  if (!content || typeof content === 'string') return []
  const urls: string[] = []
  for (const part of content) {
    if (part.type === 'audio' && part.audio?.url) {
      urls.push(resolveMediaUrl(part.audio.url))
    }
    if (part.type === 'input_audio' && part.input_audio?.url) {
      urls.push(resolveMediaUrl(part.input_audio.url))
    }
  }
  return urls
}

function formatModelTag(model: Model): string {
  const caps = model.capabilities
  if (caps && caps.input.length > 0 && caps.output.length > 0) {
    return `[${caps.input.join('+')}->${caps.output.join('+')}]`
  }
  if (model.endpoint_type && model.endpoint_type !== 'llm') {
    return `[${model.endpoint_type}]`
  }
  return ''
}

function modelHealthStatus(model: Model): 'up' | 'down' | 'unknown' {
  return model.waypoi_health?.status ?? 'unknown'
}

function isModelSelectable(model: Model): boolean {
  return modelHealthStatus(model) !== 'down'
}

function firstSelectableModelId(models: Model[]): string {
  return models.find(isModelSelectable)?.id ?? ''
}

// Maximum tool iterations per user message to prevent infinite loops
const MAX_TOOL_ITERATIONS = 10

type NumericGenerationParamKey =
  | 'temperature'
  | 'top_p'
  | 'max_tokens'
  | 'presence_penalty'
  | 'frequency_penalty'
  | 'seed'

function parseGenerationParams(draft: GenerationParamsDraft): { payload: GenerationParamsPayload; error?: string } {
  const payload: GenerationParamsPayload = {}
  const parseNumber = (
    raw: string,
    label: string,
    key: NumericGenerationParamKey,
    opts?: { min?: number; max?: number; integer?: boolean }
  ): string | null => {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      return `${label} must be a valid number.`
    }
    if (opts?.integer && !Number.isInteger(parsed)) {
      return `${label} must be an integer.`
    }
    if (typeof opts?.min === 'number' && parsed < opts.min) {
      return `${label} must be >= ${opts.min}.`
    }
    if (typeof opts?.max === 'number' && parsed > opts.max) {
      return `${label} must be <= ${opts.max}.`
    }
    payload[key] = parsed
    return null
  }

  const errors = [
    parseNumber(draft.temperature, 'Temperature', 'temperature'),
    parseNumber(draft.topP, 'Top P', 'top_p', { min: 0, max: 1 }),
    parseNumber(draft.maxTokens, 'Max Tokens', 'max_tokens', { min: 1, integer: true }),
    parseNumber(draft.presencePenalty, 'Presence Penalty', 'presence_penalty', { min: -2, max: 2 }),
    parseNumber(draft.frequencyPenalty, 'Frequency Penalty', 'frequency_penalty', { min: -2, max: 2 }),
    parseNumber(draft.seed, 'Seed', 'seed', { min: 0, integer: true }),
  ].filter((error): error is string => Boolean(error))

  const stops = draft.stop
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (stops.length === 1) payload.stop = stops[0]
  if (stops.length > 1) payload.stop = stops

  return { payload, error: errors[0] }
}

export function AgentPlayground() {
  const MAX_INPUT_LINES = 10
  const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48
  // Session state
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeSessionStorageVersion, setActiveSessionStorageVersion] = useState<number>(2)
  const [sessionName, setSessionName] = useState('')
  const [titleGenerationSessionId, setTitleGenerationSessionId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  
  // Chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>(() => loadSettings().lastPlaygroundModel ?? '')
  const [models, setModels] = useState<Model[]>([])

  const selectedModelSupportsImageOutput = (): boolean => {
    const model = models.find(m => m.id === selectedModel)
    if (!model) return false
    if (model.capabilities?.output?.includes('image')) return true
    return (model.endpoint_type ?? 'llm') === 'diffusion'
  }

  const selectedModelSupportsCall = (): boolean => {
    const model = models.find(m => m.id === selectedModel)
    if (!model?.capabilities) return false
    return model.capabilities.input.includes('audio') && model.capabilities.output.includes('audio')
  }

  const modelSupportsCall = selectedModelSupportsCall()
  const selectedModelConfig = models.find((model) => model.id === selectedModel)
  const selectedModelIsSelectable = selectedModelConfig ? isModelSelectable(selectedModelConfig) : false
  
  // Image input state
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [pendingAudio, setPendingAudio] = useState<string | null>(null)
  const [pendingAudioMimeType, setPendingAudioMimeType] = useState<string | undefined>(undefined)
  const [isDragging, setIsDragging] = useState(false)
  const [callModeEnabled, setCallModeEnabled] = useState(false)
  const [callStatus, setCallStatus] = useState<'idle' | 'recording' | 'sending' | 'playing'>('idle')
  const [callError, setCallError] = useState<string | null>(null)
  const playgroundSettings = loadSettings()
  const [generationParamsCompact, setGenerationParamsCompact] = useState(() => playgroundSettings.generationParamsCompact ?? true)
  const [generationParams, setGenerationParams] = useState<GenerationParamsDraft>(() =>
    playgroundSettings.generationParams ?? DEFAULT_GENERATION_PARAMS
  )
  
  // Image generation settings
  const [imageSize, setImageSize] = useState<ImageSize>(() => loadSettings().defaultImageSize)
  
  // Agentic mode state
  const [agentModeEnabled, setAgentModeEnabled] = useState(false)
  const [showToolPicker, setShowToolPicker] = useState(false)
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set())
  const [availableTools, setAvailableTools] = useState<McpTool[]>([])
  const [currentIteration, setCurrentIteration] = useState(0)
  const [isExecutingTools, setIsExecutingTools] = useState(false)
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const stopAgentRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isStreamingRef = useRef(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const callAudioRef = useRef<HTMLAudioElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pendingAutoTitleRef = useRef<{ sessionId: string; seedText: string } | null>(null)
  const isPinnedToBottomRef = useRef(true)
  const forceScrollToBottomRef = useRef(false)

  const saveGenerationParamsToSettings = useCallback((params: GenerationParamsDraft) => {
    const saved = loadSettings()
    saveSettings({ ...saved, generationParams: params })
  }, [])

  const rememberSelectedModel = useCallback((modelId: string) => {
    setSelectedModel(modelId)
    if (modelId) {
      updateSetting('lastPlaygroundModel', modelId)
    }
  }, [])

  const resizeInput = useCallback(() => {
    const textarea = inputRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 20
    const maxHeight = lineHeight * MAX_INPUT_LINES
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [MAX_INPUT_LINES])

  // Load models on mount
  useEffect(() => {
    async function loadModels() {
      try {
        const response = await listModels()
        setModels(response.data)
        if (response.data.length > 0 && !selectedModel) {
          rememberSelectedModel(firstSelectableModelId(response.data))
        }
      } catch (error) {
        console.error('Failed to load models:', error)
      }
    }
    loadModels()
  }, [rememberSelectedModel, selectedModel])

  // Ensure selected model stays selectable after health refreshes/session restore.
  useEffect(() => {
    if (models.length === 0) return
    const current = models.find((model) => model.id === selectedModel)
    if (!current || !isModelSelectable(current)) {
      rememberSelectedModel(firstSelectableModelId(models))
    }
  }, [models, rememberSelectedModel, selectedModel])

  // Load sessions on mount
  useEffect(() => {
    async function loadSessions() {
      try {
        const response = await listSessions()
        setSessions(response.data)
      } catch (error) {
        console.error('Failed to load sessions:', error)
      }
    }
    loadSessions()
  }, [])

  // Load tools when agent mode is enabled
  useEffect(() => {
    if (agentModeEnabled) {
      loadTools()
    }
  }, [agentModeEnabled])

  useEffect(() => {
    resizeInput()
  }, [input, resizeInput])

  const loadTools = async () => {
    try {
      const response = await listMcpTools()
      setAvailableTools(response.data)
      // Auto-select built-in tools the first time agent mode is enabled
      setSelectedTools((prev) => {
        if (prev.size > 0) return prev
        const builtinNames = response.data
          .filter((t) => t.serverId === BUILTIN_SERVER_ID)
          .map((t) => t.name)
        return builtinNames.length > 0 ? new Set(builtinNames) : prev
      })
    } catch (error) {
      console.error('Failed to load tools:', error)
    }
  }

  const normalizeMessageForUi = (message: Message): Message => ({
    ...message,
    content: normalizeContentMedia(message.content) as Message['content'],
    images: message.images?.map((value) => resolveMediaUrl(value)),
  })

  const updatePinnedToBottom = useCallback((nextValue: boolean) => {
    isPinnedToBottomRef.current = nextValue
    setIsPinnedToBottom((prev) => (prev === nextValue ? prev : nextValue))
  }, [])

  const enableFollowOutput = useCallback(() => {
    forceScrollToBottomRef.current = true
    updatePinnedToBottom(true)
  }, [updatePinnedToBottom])

  const isNearBottom = useCallback((container: HTMLDivElement) => {
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    return distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX
  }, [AUTO_SCROLL_BOTTOM_THRESHOLD_PX])

  const syncPinnedToBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    updatePinnedToBottom(isNearBottom(container))
  }, [isNearBottom, updatePinnedToBottom])

  const handleMessagesScroll = useCallback(() => {
    syncPinnedToBottom()
  }, [syncPinnedToBottom])

  // Auto-scroll to bottom only when the user is following the latest output.
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const shouldScroll = forceScrollToBottomRef.current || isPinnedToBottom
    if (!shouldScroll) return

    const behavior = isStreamingRef.current || forceScrollToBottomRef.current ? 'auto' : 'smooth'
    messagesEndRef.current?.scrollIntoView({ behavior })

    forceScrollToBottomRef.current = false
    requestAnimationFrame(() => {
      syncPinnedToBottom()
    })
  }, [isPinnedToBottom, messages, syncPinnedToBottom])

  // Load session messages when switching
  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const session = await getSession(sessionId)
      setActiveSessionId(session.id)
      setActiveSessionStorageVersion(session.storageVersion ?? 1)
      setSessionName(session.name)
      if (session.model) setSelectedModel(session.model)
      enableFollowOutput()
      setMessages(session.messages.map(m => {
        const normalized = normalizeSessionMessageMedia(m)
        return ({
        id: crypto.randomUUID(),
        role: normalized.role as Message['role'],
        content: normalizeContentMedia(normalized.content) as Message['content'],
        images: normalized.images,
        model: normalized.model,
        createdAt: new Date(m.createdAt ?? m.timestamp ?? new Date().toISOString()),
      })}))
    } catch (error) {
      console.error('Failed to load session:', error)
    }
  }, [enableFollowOutput])

  // Create new session
  const handleNewSession = useCallback(async () => {
    try {
      const session = await createSession(undefined, selectedModel)
      setSessions(prev => [{ 
        id: session.id, 
        name: session.name, 
        model: session.model,
        messageCount: 0,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }, ...prev])
      setActiveSessionId(session.id)
      setActiveSessionStorageVersion(session.storageVersion ?? 2)
      setSessionName(session.name)
      pendingAutoTitleRef.current = null
      enableFollowOutput()
      setMessages([])
    } catch (error) {
      console.error('Failed to create session:', error)
    }
  }, [enableFollowOutput, selectedModel])

  // Delete session
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      if (titleGenerationSessionId === sessionId) {
        setTitleGenerationSessionId(null)
      }
      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
        setActiveSessionStorageVersion(2)
        enableFollowOutput()
        setMessages([])
        setSessionName('')
        pendingAutoTitleRef.current = null
      }
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  // Image handling
  const processImages = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(async (file) => {
      if (!file.type.startsWith('image/')) return
      try {
        const base64 = await compressImageFileForUpload(file)
        setPendingImages(prev => [...prev, base64])
      } catch (error) {
        console.warn('Failed to compress image, using raw data URL:', error)
        const fallback = await fileToDataUrl(file)
        setPendingImages(prev => [...prev, fallback])
      }
    })
  }, [])

  const processAudioFile = useCallback((file: File) => {
    if (!file.type.startsWith('audio/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const base64 = e.target?.result as string
      setPendingAudio(base64)
      setPendingAudioMimeType(file.type || undefined)
      setCallError(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const processSelectedFiles = useCallback((files: FileList | File[]) => {
    const entries = Array.from(files)
    const imageFiles = entries.filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length > 0) {
      processImages(imageFiles)
    }
    if (callModeEnabled) {
      const audioFile = entries.find((file) => file.type.startsWith('audio/'))
      if (audioFile) {
        processAudioFile(audioFile)
      }
    }
  }, [callModeEnabled, processAudioFile, processImages])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      processSelectedFiles(e.dataTransfer.files)
    }
  }, [processSelectedFiles])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile()
        if (file) imageFiles.push(file)
      } else if (callModeEnabled && items[i].type.startsWith('audio/')) {
        const file = items[i].getAsFile()
        if (file) processAudioFile(file)
      }
    }
    if (imageFiles.length > 0) {
      processImages(imageFiles)
    }
  }, [callModeEnabled, processAudioFile, processImages])

  const stopPlayback = useCallback(() => {
    if (callAudioRef.current) {
      callAudioRef.current.pause()
      callAudioRef.current.currentTime = 0
      callAudioRef.current = null
    }
    if (callStatus === 'playing') {
      setCallStatus('idle')
    }
  }, [callStatus])

  const clearRecordingTimer = () => {
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }

  const stopMediaStream = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }
  }

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') {
      clearRecordingTimer()
      stopMediaStream()
      setCallStatus('idle')
      return
    }
    recorder.stop()
    clearRecordingTimer()
  }, [])

  const cancelRecording = useCallback(() => {
    stopRecording()
    setPendingAudio(null)
    setPendingAudioMimeType(undefined)
    setCallError(null)
  }, [stopRecording])

  const startRecording = useCallback(async () => {
    if (!selectedModelSupportsCall() || isLoading || callStatus === 'sending') {
      return
    }

    try {
      stopPlayback()
      setCallError(null)
      setCallStatus('recording')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      let recorder: MediaRecorder
      try {
        recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      } catch {
        recorder = new MediaRecorder(stream)
      }
      mediaRecorderRef.current = recorder
      const chunks: BlobPart[] = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }

      recorder.onstop = async () => {
        stopMediaStream()
        clearRecordingTimer()
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result as string
            setPendingAudio(result)
            setPendingAudioMimeType(blob.type || 'audio/webm')
            setCallStatus('idle')
          }
          reader.readAsDataURL(blob)
        } else {
          setCallStatus('idle')
        }
      }

      recorder.start()
      recordingTimerRef.current = window.setTimeout(() => {
        stopRecording()
      }, 60_000)
    } catch (error) {
      console.error('Microphone access failed:', error)
      setCallStatus('idle')
      setCallError('Microphone permission denied or unavailable. You can upload an audio file instead.')
    }
  }, [callStatus, isLoading, modelSupportsCall, stopPlayback, stopRecording])

  useEffect(() => {
    if (!modelSupportsCall && callModeEnabled) {
      setCallModeEnabled(false)
      setPendingAudio(null)
      setPendingAudioMimeType(undefined)
      setCallStatus('idle')
      setCallError(null)
    }
  }, [callModeEnabled, modelSupportsCall])

  useEffect(() => {
    return () => {
      clearRecordingTimer()
      stopMediaStream()
      stopPlayback()
    }
  }, [stopPlayback])

  // Build tools array for the API
  const buildToolsForApi = () => {
    if (!agentModeEnabled || selectedTools.size === 0) return undefined
    
    return availableTools
      .filter(t => selectedTools.has(t.name))
      .map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.inputSchema,
        },
      }))
  }

  // Execute a tool and return result
  const executeToolCall = async (toolCall: ToolCall): Promise<string> => {
    try {
      const args = JSON.parse(toolCall.arguments)
      const result = await executeMcpTool(toolCall.name, args)
      return result.result
    } catch (error) {
      let reason = (error as Error).message
      if (error instanceof ApiError) {
        const body = error.body as { error?: { message?: string } } | undefined
        if (body?.error?.message) {
          reason = body.error.message
        }
      }
      throw new Error(`Tool execution failed: ${reason}`)
    }
  }

  // Stop the agent loop
  const stopAgent = () => {
    stopAgentRef.current = true
    abortControllerRef.current?.abort()
  }

  // The main agentic loop
  const runAgentLoop = async (
    conversationHistory: Message[],
    assistantMessageId: string,
    generationPayload: GenerationParamsPayload
  ): Promise<void> => {
    let iteration = 0
    let currentHistory = [...conversationHistory]
    
    while (iteration < MAX_TOOL_ITERATIONS && !stopAgentRef.current) {
      setCurrentIteration(iteration + 1)
      
      // Build messages for API
      const chatMessages = currentHistory.map(m => {
        if (m.role === 'tool' && m.toolCallId) {
          return {
            role: 'tool' as const,
            tool_call_id: m.toolCallId,
            content: m.content,
          }
        }
        return toApiMessage(m)
      }) as ApiChatMessage[]
      warnIfNonDataImageUrls(chatMessages, 'agent-loop')

      // Stream the response
      abortControllerRef.current = new AbortController()
      isStreamingRef.current = true
      let fullContent = ''
      let toolCallsData: Array<{
        id: string
        function: { name: string; arguments: string }
      }> = []
      
      try {
        for await (const chunk of streamChatCompletionWithTools(
          { 
            model: selectedModel, 
            messages: chatMessages,
            ...generationPayload,
            tools: buildToolsForApi(),
            tool_choice: selectedTools.size > 0 ? 'auto' : undefined,
          },
          abortControllerRef.current.signal,
          (tc) => { toolCallsData = tc }
        )) {
          if (stopAgentRef.current) break
          fullContent += chunk
          setMessages(prev => 
            prev.map(m => 
              m.id === assistantMessageId 
                ? { ...m, content: fullContent }
                : m
            )
          )
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
        throw error
      }

      // Check if we have tool calls
      if (toolCallsData.length > 0 && !stopAgentRef.current) {
        // Create tool call objects
        const toolCalls: ToolCall[] = toolCallsData.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
          status: 'pending' as const,
        }))

        // Update message with tool calls
        setMessages(prev => 
          prev.map(m => 
            m.id === assistantMessageId 
              ? { ...m, content: fullContent || null, toolCalls }
              : m
          )
        )

        // Execute tools
        setIsExecutingTools(true)
        const toolResults: Message[] = []
        
        for (const toolCall of toolCalls) {
          if (stopAgentRef.current) break
          
          // Update status to executing
          setMessages(prev => 
            prev.map(m => 
              m.id === assistantMessageId 
                ? { 
                    ...m, 
                    toolCalls: m.toolCalls?.map(tc => 
                      tc.id === toolCall.id ? { ...tc, status: 'executing' as const } : tc
                    )
                  }
                : m
            )
          )

          try {
            const result = await executeToolCall(toolCall)
            
            // Update status to success
            setMessages(prev => 
              prev.map(m => 
                m.id === assistantMessageId 
                  ? { 
                      ...m, 
                      toolCalls: m.toolCalls?.map(tc => 
                        tc.id === toolCall.id 
                          ? { ...tc, status: 'success' as const, result } 
                          : tc
                      )
                    }
                  : m
              )
            )

            // Add tool result message
            toolResults.push({
              id: crypto.randomUUID(),
              role: 'tool',
              content: result,
              toolCallId: toolCall.id,
              createdAt: new Date(),
            })
          } catch (error) {
            const errorMsg = (error as Error).message
            
            // Update status to error
            setMessages(prev => 
              prev.map(m => 
                m.id === assistantMessageId 
                  ? { 
                      ...m, 
                      toolCalls: m.toolCalls?.map(tc => 
                        tc.id === toolCall.id 
                          ? { ...tc, status: 'error' as const, error: errorMsg } 
                          : tc
                      )
                    }
                  : m
              )
            )

            // Still add a tool result for the error
            toolResults.push({
              id: crypto.randomUUID(),
              role: 'tool',
              content: `Error: ${errorMsg}`,
              toolCallId: toolCall.id,
              createdAt: new Date(),
            })
          }
        }

        setIsExecutingTools(false)

        if (stopAgentRef.current) break

        // Add assistant message with tool calls and tool results to history
        const assistantWithToolCalls: Message = {
          id: assistantMessageId,
          role: 'assistant',
          content: fullContent || null,
          toolCalls,
          createdAt: new Date(),
        }
        
        currentHistory = [...currentHistory.slice(0, -1), assistantWithToolCalls, ...toolResults]
        
        // Create new assistant message for next iteration
        const newAssistantId = crypto.randomUUID()
        const newAssistantMessage: Message = {
          id: newAssistantId,
          role: 'assistant',
          content: '',
          createdAt: new Date(),
        }
        
        setMessages(prev => [...prev, ...toolResults, newAssistantMessage])
        assistantMessageId = newAssistantId
        currentHistory = [...currentHistory, newAssistantMessage]
        
        iteration++
      } else {
        // No tool calls, we're done
        break
      }
    }
    
    setCurrentIteration(0)
  }

  const warnIfNonDataImageUrls = (chatMessages: ApiChatMessage[], context: string) => {
    if (!import.meta.env.DEV) return
    const invalidUrls = findNonDataImageUrls(chatMessages)
    if (invalidUrls.length > 0) {
      console.warn(`[AgentPlayground][${context}] Non-data image URLs detected in chat payload`, invalidUrls)
    }
  }

  const extractAssistantAudio = (message: unknown): { url?: string; data?: string; format?: string } | null => {
    if (!message || typeof message !== 'object') return null
    const msg = message as Record<string, unknown>
    const direct = msg.audio as Record<string, unknown> | undefined
    if (direct && (typeof direct.url === 'string' || typeof direct.data === 'string')) {
      return {
        url: typeof direct.url === 'string' ? direct.url : undefined,
        data: typeof direct.data === 'string' ? direct.data : undefined,
        format: typeof direct.format === 'string' ? direct.format : undefined,
      }
    }
    const content = msg.content
    if (!Array.isArray(content)) return null
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const p = part as Record<string, unknown>
      const audioObj = p.audio as Record<string, unknown> | undefined
      if ((p.type === 'audio' || p.type === 'output_audio') && audioObj) {
        return {
          url: typeof audioObj.url === 'string' ? audioObj.url : undefined,
          data: typeof audioObj.data === 'string' ? audioObj.data : undefined,
          format: typeof audioObj.format === 'string' ? audioObj.format : undefined,
        }
      }
    }
    return null
  }

  const formatToMimeType = (format?: string): string | undefined => {
    if (!format) return undefined
    const lower = format.toLowerCase()
    if (lower === 'wav') return 'audio/wav'
    if (lower === 'mp3' || lower === 'mpeg') return 'audio/mpeg'
    if (lower === 'ogg') return 'audio/ogg'
    if (lower === 'webm') return 'audio/webm'
    if (lower === 'm4a' || lower === 'mp4') return 'audio/mp4'
    return undefined
  }

  const maybeAutoTitleSession = async (sessionId: string): Promise<void> => {
    await flushDeferredAutoTitle({
      sessionId,
      sessionName,
      model: selectedModel,
      queuedCandidate: pendingAutoTitleRef.current,
      generatingSessionId: titleGenerationSessionId,
      autoTitleSession,
      onGenerationChange: setTitleGenerationSessionId,
      onResolved: (response) => {
        setSessionName((current) => (current === sessionName ? response.name : current))
        setSessions((prev) => applyAutoTitleToSessions(prev, sessionId, response))
      },
      clearQueuedCandidate: () => {
        if (pendingAutoTitleRef.current?.sessionId === sessionId) {
          pendingAutoTitleRef.current = null
        }
      },
      onError: (error) => {
        console.warn('Auto-title skipped:', error)
      },
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedModelConfig || !isModelSelectable(selectedModelConfig)) {
      setCallError('Selected model is unavailable. Choose a healthy model and try again.')
      return
    }
    const hasText = input.trim().length > 0
    const canSend = callModeEnabled
      ? Boolean(pendingAudio)
      : hasText || pendingImages.length > 0
    if (!canSend || isLoading) return
    const { payload: generationPayload, error: generationParamError } = parseGenerationParams(generationParams)
    if (generationParamError) {
      setCallError(generationParamError)
      return
    }

    stopAgentRef.current = false
    setCallError(null)
    enableFollowOutput()

    const requestImageUrls = pendingImages.length > 0 ? [...pendingImages] : []
    let displayImageRefs = requestImageUrls.length > 0 ? [...requestImageUrls] : undefined
    if ((activeSessionStorageVersion ?? 1) >= 2 && pendingImages.length > 0) {
      try {
        const cached = await Promise.all(
          pendingImages.map((image) => cacheImage(image, selectedModel))
        )
        displayImageRefs = cached.map((item) => item.url)
      } catch (error) {
        console.error('Failed to cache input images, falling back to inline images:', error)
      }
    }

    let audioRef: string | undefined
    if (pendingAudio) {
      if ((activeSessionStorageVersion ?? 1) >= 2) {
        try {
          const cachedAudio = await storeMedia(pendingAudio, selectedModel, pendingAudioMimeType)
          audioRef = cachedAudio.url
        } catch (error) {
          console.error('Failed to cache input audio, falling back to inline audio:', error)
          audioRef = pendingAudio
        }
      } else {
        audioRef = pendingAudio
      }
    }

    const payload = buildUserPayload({
      callModeEnabled,
      text: input,
      requestImageUrls,
      displayImageRefs,
      audioRef,
    })

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: payload.content,
      images: payload.images,
      requestImages: payload.requestImages,
      createdAt: new Date(),
    }

    setMessages(prev => [...prev, normalizeMessageForUi(userMessage)])
    setInput('')
    setPendingImages([])
    setPendingAudio(null)
    setPendingAudioMimeType(undefined)
    setIsLoading(true)

    // Save user message to session
    if (activeSessionId) {
      try {
        await addMessageToSession(activeSessionId, {
          role: 'user',
          content: userMessage.content,
          images: userMessage.images,
          timestamp: userMessage.createdAt.toISOString(),
        })
        const textForTitle = getTextContent(userMessage.content)
        const autoTitleCandidate = createDeferredAutoTitleCandidate(activeSessionId, sessionName, textForTitle)
        if (autoTitleCandidate) {
          pendingAutoTitleRef.current = autoTitleCandidate
        }
      } catch (error) {
        console.error('Failed to save user message:', error)
      }
    }

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      model: selectedModel,
      generationParams: Object.keys(generationPayload).length > 0 ? generationPayload : undefined,
      createdAt: new Date(),
    }
    setMessages(prev => [...prev, normalizeMessageForUi(assistantMessage)])

    try {
      if (callModeEnabled) {
        setCallStatus('sending')
        const chatMessages = [...messages, userMessage].map(toApiMessage)
        warnIfNonDataImageUrls(chatMessages, 'call-mode')
        const response = await createChatCompletionRaw({
          model: selectedModel,
          messages: chatMessages,
          stream: false,
          ...generationPayload,
        })
        const assistant = response.choices?.[0]?.message
        const assistantText =
          typeof assistant?.content === 'string'
            ? assistant.content
            : getTextContent((assistant?.content as ContentPart[] | null) ?? null)

        const audio = extractAssistantAudio(assistant)
        let assistantAudioUrl: string | undefined
        if (audio?.url) {
          assistantAudioUrl = resolveMediaUrl(audio.url)
        } else if (audio?.data) {
          const dataUrl = audio.data.startsWith('data:')
            ? audio.data
            : `data:${formatToMimeType(audio.format) ?? 'audio/wav'};base64,${audio.data}`
          if ((activeSessionStorageVersion ?? 1) >= 2) {
            const cached = await storeMedia(
              dataUrl,
              selectedModel,
              formatToMimeType(audio.format) ?? pendingAudioMimeType
            )
            assistantAudioUrl = cached.url
          } else {
            assistantAudioUrl = dataUrl
          }
        }

        const assistantContent: ContentPart[] = [
          ...(assistantText ? [{ type: 'text' as const, text: assistantText }] : []),
          ...(assistantAudioUrl
            ? [{ type: 'audio' as const, audio: { url: assistantAudioUrl, format: audio?.format } }]
            : []),
        ]

        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMessage.id
              ? { ...m, content: assistantContent.length > 0 ? assistantContent : assistantText || '' }
              : m
          )
        )

        if (assistantAudioUrl) {
          stopPlayback()
          const player = new Audio(assistantAudioUrl)
          callAudioRef.current = player
          setCallStatus('playing')
          player.onended = () => {
            setCallStatus('idle')
            callAudioRef.current = null
          }
          player.onerror = () => {
            setCallStatus('idle')
            callAudioRef.current = null
          }
          void player.play().catch((error) => {
            console.warn('Audio playback failed:', error)
            setCallStatus('idle')
            callAudioRef.current = null
          })
        } else {
          setCallStatus('idle')
        }

        if (activeSessionId) {
          await addMessageToSession(activeSessionId, {
            role: 'assistant',
            content: assistantContent.length > 0 ? assistantContent : assistantText || '',
            timestamp: new Date().toISOString(),
            model: selectedModel,
          })
          await maybeAutoTitleSession(activeSessionId)
        }
      } else if (selectedModelSupportsImageOutput()) {
        // Image generation mode
        const prompt = getTextContent(userMessage.content)
        if (!prompt) {
          throw new Error('Please enter a prompt for image generation')
        }
        
        const editInputImageUrl = requestImageUrls.length > 0 ? requestImageUrls[0] : undefined
        const imageResponse = await generateImage({
          model: selectedModel,
          prompt,
          image_url: editInputImageUrl,
          n: 1,
          size: imageSize,
          response_format: 'b64_json',
        })
        
        // Convert response to content with image
        const imageData = imageResponse.data[0]
        let imageUrl = imageData.url || ''
        if (!imageUrl && imageData.b64_json) {
          if ((activeSessionStorageVersion ?? 1) >= 2) {
            try {
              const cached = await cacheImage(imageData.b64_json, selectedModel)
              imageUrl = cached.url
            } catch (error) {
              console.error('Failed to cache generated image, using inline payload:', error)
              imageUrl = `data:image/png;base64,${imageData.b64_json}`
            }
          } else {
            imageUrl = `data:image/png;base64,${imageData.b64_json}`
          }
        }
        
        const imageContent: ContentPart[] = []
        if (imageData.revised_prompt) {
          imageContent.push({ type: 'text', text: imageData.revised_prompt })
        }
        if (imageUrl) {
          imageContent.push({ type: 'image_url', image_url: { url: imageUrl } })
        }
        
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMessage.id
              ? { ...m, content: imageContent }
              : m
          )
        )
        
        // Save to session
        if (activeSessionId) {
          try {
            await addMessageToSession(activeSessionId, {
              role: 'assistant',
              content: imageContent,
              timestamp: new Date().toISOString(),
              model: selectedModel,
            })
            await maybeAutoTitleSession(activeSessionId)
          } catch (error) {
            console.error('Failed to save assistant message:', error)
          }
        }
      } else if (agentModeEnabled && selectedTools.size > 0) {
        // Run agentic loop
        await runAgentLoop(
          [...messages, userMessage, assistantMessage],
          assistantMessage.id,
          generationPayload
        )
        if (activeSessionId) {
          await maybeAutoTitleSession(activeSessionId)
        }
      } else {
        // Regular chat (LLM, embedding, audio handled as chat for now)
        abortControllerRef.current = new AbortController()
        isStreamingRef.current = true
        
        const chatMessages = [...messages, userMessage].map(toApiMessage) as ApiChatMessage[]
        warnIfNonDataImageUrls(chatMessages, 'chat-stream')

        let streamState = createThinkingStreamState()
        for await (const chunk of streamChatCompletion(
          { model: selectedModel, messages: chatMessages, ...generationPayload },
          abortControllerRef.current.signal
        )) {
          streamState = applyThinkingChunk(streamState, chunk)
          const displayContent = toDisplayContent(streamState)
          setMessages(prev => 
            prev.map(m => 
              m.id === assistantMessage.id 
                ? { ...m, content: displayContent }
                : m
            )
          )
        }
        const finalContent = toFinalContent(streamState)
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMessage.id
              ? { ...m, content: finalContent }
              : m
          )
        )

        // Save assistant message
        if (activeSessionId && finalContent) {
          try {
            await addMessageToSession(activeSessionId, {
              role: 'assistant',
              content: finalContent,
              timestamp: new Date().toISOString(),
              model: selectedModel,
            })
            await maybeAutoTitleSession(activeSessionId)
          } catch (error) {
            console.error('Failed to save assistant message:', error)
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      console.error('Chat error:', error)
      if (callModeEnabled) {
        setCallError((error as Error).message || 'Call turn failed. Try again.')
      }
      setCallStatus('idle')
      setMessages(prev => 
        prev.map(m => 
          m.id === assistantMessage.id 
            ? { ...m, content: 'Error occurred. Please try again.' }
            : m
        )
      )
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
      stopAgentRef.current = false
      isStreamingRef.current = false
      if (!callAudioRef.current) {
        setCallStatus('idle')
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleRegenerate = async (_assistantMessageId: string) => {
    if (!selectedModelConfig || !isModelSelectable(selectedModelConfig)) {
      setCallError('Selected model is unavailable. Choose a healthy model and try again.')
      return
    }
    const { payload: generationPayload, error: generationParamError } = parseGenerationParams(generationParams)
    if (generationParamError) {
      setCallError(generationParamError)
      return
    }
    stopAgentRef.current = false
    setCallError(null)
    enableFollowOutput()
    setIsLoading(true)
    const newAssistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      model: selectedModel,
      generationParams: Object.keys(generationPayload).length > 0 ? generationPayload : undefined,
      createdAt: new Date(),
    }
    setMessages(prev => [...prev, normalizeMessageForUi(newAssistantMessage)])
    try {
      if (agentModeEnabled && selectedTools.size > 0) {
        await runAgentLoop(
          [...messages, newAssistantMessage],
          newAssistantMessage.id,
          generationPayload
        )
        if (activeSessionId) await maybeAutoTitleSession(activeSessionId)
      } else {
        abortControllerRef.current = new AbortController()
        isStreamingRef.current = true
        const chatMessages = messages.map(toApiMessage) as ApiChatMessage[]
        warnIfNonDataImageUrls(chatMessages, 'regenerate')
        let streamState = createThinkingStreamState()
        for await (const chunk of streamChatCompletion(
          { model: selectedModel, messages: chatMessages, ...generationPayload },
          abortControllerRef.current.signal
        )) {
          streamState = applyThinkingChunk(streamState, chunk)
          const displayContent = toDisplayContent(streamState)
          setMessages(prev =>
            prev.map(m =>
              m.id === newAssistantMessage.id
                ? { ...m, content: displayContent }
                : m
            )
          )
        }
        const finalContent = toFinalContent(streamState)
        setMessages(prev =>
          prev.map(m =>
            m.id === newAssistantMessage.id
              ? { ...m, content: finalContent }
              : m
          )
        )
        if (activeSessionId && finalContent) {
          try {
            await addMessageToSession(activeSessionId, {
              role: 'assistant',
              content: finalContent,
              timestamp: new Date().toISOString(),
              model: selectedModel,
            })
            await maybeAutoTitleSession(activeSessionId)
          } catch (error) {
            console.error('Failed to save assistant message:', error)
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      console.error('Regenerate error:', error)
      setCallError((error as Error).message || 'Regeneration failed. Try again.')
      setMessages(prev =>
        prev.map(m =>
          m.id === newAssistantMessage.id
            ? { ...m, content: 'Error occurred. Please try again.' }
            : m
        )
      )
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
      stopAgentRef.current = false
      isStreamingRef.current = false
    }
  }

  return (
    <div className="flex-1 flex h-full min-h-0 overflow-hidden">
      {/* Sessions Sidebar */}
      <aside className={cn(
        'border-r border-border flex flex-col min-h-0 shrink-0 transition-all duration-300',
        sidebarCollapsed ? 'w-12' : 'w-64'
      )}>
        <div className="h-14 border-b border-border flex items-center justify-between px-3">
          {!sidebarCollapsed && (
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Sessions
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <ChevronRight className={cn(
              'w-4 h-4 transition-transform',
              !sidebarCollapsed && 'rotate-180'
            )} />
          </Button>
        </div>
        
        {!sidebarCollapsed && (
          <>
            <div className="p-2">
              <Button 
                onClick={handleNewSession}
                className="w-full justify-start gap-2"
                variant="outline"
              >
                <Plus className="w-4 h-4" />
                New Chat
              </Button>
            </div>
            
            <div className="flex-1 overflow-y-auto">
              {sessions.map(session => (
                <div 
                  key={session.id}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-secondary/50 transition-colors',
                    activeSessionId === session.id && 'bg-secondary border-l-2 border-primary'
                  )}
                  onClick={() => loadSession(session.id)}
                >
                  <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{session.name}</p>
                    <p className="text-2xs text-muted-foreground">
                      {titleGenerationSessionId === session.id ? 'Generating title...' : `${session.messageCount} messages`}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteSession(session.id)
                    }}
                  >
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                </div>
              ))}
              
              {sessions.length === 0 && (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  No sessions yet
                </div>
              )}
            </div>
          </>
        )}
      </aside>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header */}
        <header className="sticky top-0 z-20 h-14 border-b border-border bg-background/95 backdrop-blur flex items-center px-6 gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="font-mono font-semibold text-sm uppercase tracking-wider">
              {sessionName || 'Playground'}
            </h2>
            {titleGenerationSessionId === activeSessionId && (
              <span className="text-2xs font-mono uppercase tracking-wider text-muted-foreground">
                Generating title...
              </span>
            )}
          </div>
          
          {/* Agent Mode Toggle */}
          <button
            onClick={() => {
              setAgentModeEnabled(!agentModeEnabled)
              if (!agentModeEnabled) setShowToolPicker(true)
            }}
            className={cn(
              'flex items-center gap-2 px-2 py-1 rounded-md text-xs font-mono transition-colors',
              agentModeEnabled
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            )}
          >
            {agentModeEnabled ? (
              <ToggleRight className="w-4 h-4" />
            ) : (
              <ToggleLeft className="w-4 h-4" />
            )}
            Agent Mode
            {selectedTools.size > 0 && (
              <span className="px-1.5 py-0.5 bg-primary/30 rounded text-2xs">
                {selectedTools.size}
              </span>
            )}
          </button>

          {agentModeEnabled && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setShowToolPicker(!showToolPicker)}
            >
              <Wrench className="w-3.5 h-3.5" />
              Tools
            </Button>
          )}

          {modelSupportsCall && (
            <Button
              variant={callModeEnabled ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => {
                setCallModeEnabled(!callModeEnabled)
                setPendingAudio(null)
                setPendingAudioMimeType(undefined)
                setCallError(null)
                if (callStatus === 'recording') {
                  stopRecording()
                }
                stopPlayback()
              }}
            >
              {callModeEnabled ? <PhoneCall className="w-3.5 h-3.5" /> : <PhoneOff className="w-3.5 h-3.5" />}
              Call
            </Button>
          )}
          
          <div className="flex-1" />
          
          <select 
            value={selectedModel}
            onChange={(e) => rememberSelectedModel(e.target.value)}
            className="bg-input border border-border rounded px-3 py-1.5 text-sm font-mono focus:ring-1 focus:ring-primary focus:outline-none"
          >
            {models.length === 0 && <option value="">No models available</option>}
            {models.map(model => (
              <option key={model.id} value={model.id} disabled={!isModelSelectable(model)}>
                {model.id} {formatModelTag(model)} {!isModelSelectable(model) ? '(down)' : ''}
              </option>
            ))}
          </select>
        </header>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Messages Area */}
          <div className="flex-1 min-h-0 flex flex-col">
        <div 
          ref={messagesContainerRef}
          className={cn(
            'flex-1 min-h-0 overflow-y-auto p-6 space-y-4 relative',
            isDragging && 'bg-primary/5 border-2 border-dashed border-primary/30'
          )}
              onScroll={handleMessagesScroll}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              {isDragging && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                  <div className="bg-background/90 rounded-lg p-6 text-center">
                    <ImageIcon className="w-12 h-12 text-primary mx-auto mb-2" />
                    <p className="font-mono text-sm">
                      {callModeEnabled ? 'Drop image or audio here' : 'Drop image here'}
                    </p>
                  </div>
                </div>
              )}
              
              {messages.length === 0 && (
                <div className="flex-1 flex items-center justify-center h-full">
                  <div className="text-center space-y-4 animate-fade-in">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                      <Bot className="w-8 h-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-mono font-semibold text-lg">Ready to chat</h3>
                      <p className="text-muted-foreground text-sm mt-1">
                        {agentModeEnabled 
                          ? 'Agent mode enabled - select tools to use'
                          : 'Select a model and start a conversation'}
                      </p>
                  <p className="text-muted-foreground text-xs mt-2">
                    {callModeEnabled
                      ? 'Call mode: push-to-talk + optional text/images'
                      : 'Supports images via drag, drop, paste, or upload'}
                  </p>
                </div>
              </div>
                </div>
              )}
              
              {messages.map((message, index) => (
                <div
                  key={message.id}
                  className={cn(
                    'flex gap-3 animate-slide-in-bottom',
                    message.role === 'user' ? 'justify-end' : 'justify-start',
                    message.role === 'tool' && 'opacity-70'
                  )}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  {message.role === 'assistant' && (
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                        <Bot className="w-4 h-4 text-muted-foreground" />
                      </div>
                      {message.model && (
                        <span className="text-[9px] font-mono text-muted-foreground/50 truncate max-w-[5rem] select-none">
                          {message.model}
                        </span>
                      )}
                    </div>
                  )}
                  {message.role === 'tool' && (
                    <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                      <Wrench className="w-4 h-4 text-amber-500" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'rounded-lg px-4 py-3',
                      message.role === 'user'
                        ? 'max-w-[70%] bg-primary/10 border border-primary/20'
                        : message.role === 'tool'
                        ? 'max-w-[70%] bg-amber-500/5 border border-amber-500/20'
                        : 'w-full sm:w-[70%] max-w-[75ch] bg-secondary border border-border'
                    )}
                  >
                    {/* Render explicitly attached images */}
                {message.images && message.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {message.images.map((img, i) => (
                      <img 
                        key={i} 
                        src={resolveMediaUrl(img)} 
                        alt={`Attached ${i + 1}`}
                        className="max-w-32 max-h-32 rounded border border-border"
                      />
                    ))}
                  </div>
                    )}
                    {/* Render images from multimodal content (e.g., image generation responses) */}
                    {getImageUrls(message.content).length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {getImageUrls(message.content).map((url, i) => (
                          <a 
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block"
                          >
                            <img 
                              src={url} 
                              alt={`Generated ${i + 1}`}
                              className="max-w-xs max-h-64 rounded border border-border hover:border-primary transition-colors cursor-pointer"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                    {getAudioUrls(message.content).length > 0 && (
                      <div className="flex flex-col gap-2 mb-2">
                        {getAudioUrls(message.content).map((url, i) => (
                          <audio
                            key={i}
                            controls
                            src={url}
                            className="w-full max-w-sm"
                          />
                        ))}
                      </div>
                    )}
                    {/* Render text content with markdown support */}
                    {getTextContent(message.content) && (
                      message.role === 'user' ? (
                        <p className="text-sm whitespace-pre-wrap">{getTextContent(message.content)}</p>
                      ) : (
                        <MessageContent content={getTextContent(message.content)} />
                      )
                    )}
                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <div className="mt-2">
                        <ToolCallMessage toolCalls={message.toolCalls} />
                      </div>
                    )}
                    {message.role === 'assistant' && message.model && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <p className="text-[10px] font-mono text-muted-foreground/60 select-none">{message.model}</p>
                        {message.generationParams && Object.keys(message.generationParams).length > 0 && (
                          <span className="text-[10px] font-mono text-muted-foreground/40 select-none">
                            {(() => {
                              const params = message.generationParams!
                              const parts = []
                              if (params.temperature !== undefined) parts.push(`temp:${params.temperature}`)
                              if (params.top_p !== undefined) parts.push(`top_p:${params.top_p}`)
                              if (params.max_tokens !== undefined) parts.push(`tokens:${params.max_tokens}`)
                              if (params.presence_penalty !== undefined) parts.push(`pres:${params.presence_penalty}`)
                              if (params.frequency_penalty !== undefined) parts.push(`freq:${params.frequency_penalty}`)
                              if (params.seed !== undefined) parts.push(`seed:${params.seed}`)
                              if (params.stop) parts.push(`stop:${Array.isArray(params.stop) ? params.stop.join('/') : params.stop}`)
                              return `[${parts.join(' ')}]`
                            })()}
                          </span>
                        )}
                        {!isLoading && (
                          <button
                            type="button"
                            className="text-[10px] font-mono text-muted-foreground/40 hover:text-primary ml-auto flex items-center gap-0.5 transition-colors"
                            onClick={() => handleRegenerate(message.id)}
                            title="Regenerate with current params"
                          >
                            <RefreshCw className="w-3 h-3" />
                            Rerun
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {message.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                  )}
                </div>
              ))}
              
              {isLoading && messages[messages.length - 1]?.content === '' && !messages[messages.length - 1]?.toolCalls && (
                <div className="flex items-start gap-3 text-muted-foreground">
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                    {messages[messages.length - 1]?.model && (
                      <span className="text-[9px] font-mono text-muted-foreground/50 truncate max-w-[5rem] select-none">
                        {messages[messages.length - 1]?.model}
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-mono">
                    {isExecutingTools 
                      ? 'Executing tools...'
                      : currentIteration > 0 
                      ? `Thinking (iteration ${currentIteration})...`
                      : 'Thinking...'}
                  </span>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Pending Images Preview */}
            {pendingImages.length > 0 && (
              <div className="border-t border-border px-4 py-2 flex gap-2 flex-wrap bg-secondary/30">
                {pendingImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img 
                      src={img} 
                      alt={`Pending ${i + 1}`}
                      className="h-16 w-16 object-cover rounded border border-border"
                    />
                    <button
                      onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {callModeEnabled && pendingAudio && (
              <div className="border-t border-border px-4 py-2 bg-secondary/20">
                <div className="flex items-center gap-2">
                  <audio controls src={pendingAudio} className="w-full max-w-md" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={cancelRecording}
                    title="Remove pending audio"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            )}

            {/* Input Area */}
            <div className="border-t border-border p-4">
              {/* Image Size Picker (shown for diffusion models) */}
              {selectedModelSupportsImageOutput() && (
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Image Size:</span>
                  <div className="flex gap-1 flex-wrap">
                    {IMAGE_SIZE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setImageSize(option.value)}
                        className={cn(
                          'px-2 py-1 text-xs font-mono rounded transition-colors',
                          imageSize === option.value
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80'
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Generation Params - Compact Badges (always visible) */}
              <div className="mb-2">
                {generationParamsCompact && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      className="text-[10px] font-mono text-muted-foreground hover:text-foreground px-1 py-0.5 rounded hover:bg-secondary/50"
                      onClick={() => {
                        setGenerationParamsCompact(false)
                        saveSettings({ ...loadSettings(), generationParamsCompact: false })
                      }}
                      title="Expand to grid view"
                    >
                      ↕ Expand
                    </button>
                    {(["temperature", "topP", "maxTokens", "presencePenalty", "frequencyPenalty", "seed", "stop"] as const).map((key) => {
                      const labels = { temperature: 'Temp', topP: 'TopP', maxTokens: 'Tokens', presencePenalty: 'Pres', frequencyPenalty: 'Freq', seed: 'Seed', stop: 'Stop' }
                      const val = generationParams[key]
                      const display = val || '—'
                      return (
                        <button
                          key={key}
                          type="button"
                          className={cn(
                            'text-xs font-mono px-1.5 py-0.5 rounded transition-colors cursor-pointer',
                            val
                              ? 'bg-primary/10 text-primary hover:bg-primary/20'
                              : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary/30'
                          )}
                          onClick={() => {
                            setGenerationParams((prev) => {
                              const next = { ...prev, [key]: '' }
                              saveGenerationParamsToSettings(next)
                              return next
                            })
                          }}
                          title={`${labels[key]}: ${display} (click to clear)`}
                        >
                          {labels[key]}:{display}
                        </button>
                      )
                    })}
                  </div>
                )}
                {!generationParamsCompact && (
                  <>
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        type="button"
                        className="text-[10px] font-mono text-muted-foreground hover:text-foreground px-1 py-0.5 rounded hover:bg-secondary/50 cursor-pointer"
                        onClick={() => {
                          setGenerationParamsCompact(true)
                          saveSettings({ ...loadSettings(), generationParamsCompact: true })
                        }}
                        title="Compact to badges view"
                      >
                        ⚡ Compact
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 rounded border border-border/60 bg-secondary/20 p-2">
                      <label className="text-xs text-muted-foreground block">
                        Temperature
                        <input
                          className="mt-1 w-full bg-input border border-border rounded px-2 py-1 text-sm font-mono"
                          value={generationParams.temperature}
                          onChange={(event) => {
                            const next = { ...generationParams, temperature: event.target.value }
                            setGenerationParams(next)
                            saveGenerationParamsToSettings(next)
                          }}
                          placeholder="e.g. 0.7"
                        />
                      </label>
                      <label className="text-xs text-muted-foreground block">
                        Top P
                        <input
                          className="mt-1 w-full bg-input border border-border rounded px-2 py-1 text-sm font-mono"
                          value={generationParams.topP}
                          onChange={(event) => {
                            const next = { ...generationParams, topP: event.target.value }
                            setGenerationParams(next)
                            saveGenerationParamsToSettings(next)
                          }}
                          placeholder="e.g. 1"
                        />
                      </label>
                      <label className="text-xs text-muted-foreground block">
                        Max Tokens
                        <input
                          className="mt-1 w-full bg-input border border-border rounded px-2 py-1 text-sm font-mono"
                          value={generationParams.maxTokens}
                          onChange={(event) => {
                            const next = { ...generationParams, maxTokens: event.target.value }
                            setGenerationParams(next)
                            saveGenerationParamsToSettings(next)
                          }}
                          placeholder="e.g. 512"
                        />
                      </label>
                      <label className="text-xs text-muted-foreground block">
                        Presence Penalty
                        <input
                          className="mt-1 w-full bg-input border border-border rounded px-2 py-1 text-sm font-mono"
                          value={generationParams.presencePenalty}
                          onChange={(event) => {
                            const next = { ...generationParams, presencePenalty: event.target.value }
                            setGenerationParams(next)
                            saveGenerationParamsToSettings(next)
                          }}
                          placeholder="-2 to 2"
                        />
                      </label>
                      <label className="text-xs text-muted-foreground block">
                        Frequency Penalty
                        <input
                          className="mt-1 w-full bg-input border border-border rounded px-2 py-1 text-sm font-mono"
                          value={generationParams.frequencyPenalty}
                          onChange={(event) => {
                            const next = { ...generationParams, frequencyPenalty: event.target.value }
                            setGenerationParams(next)
                            saveGenerationParamsToSettings(next)
                          }}
                          placeholder="-2 to 2"
                        />
                      </label>
                      <label className="text-xs text-muted-foreground block">
                        Seed
                        <input
                          className="mt-1 w-full bg-input border border-border rounded px-2 py-1 text-sm font-mono"
                          value={generationParams.seed}
                          onChange={(event) => {
                            const next = { ...generationParams, seed: event.target.value }
                            setGenerationParams(next)
                            saveGenerationParamsToSettings(next)
                          }}
                          placeholder="integer"
                        />
                      </label>
                      <label className="text-xs text-muted-foreground block col-span-2">
                        Stop Sequences (comma-separated)
                        <input
                          className="mt-1 w-full bg-input border border-border rounded px-2 py-1 text-sm font-mono"
                          value={generationParams.stop}
                          onChange={(event) => {
                            const next = { ...generationParams, stop: event.target.value }
                            setGenerationParams(next)
                            saveGenerationParamsToSettings(next)
                          }}
                          placeholder="END, STOP"
                        />
                      </label>
                    </div>
                  </>
                )}
              </div>
              <form onSubmit={handleSubmit} className="flex gap-3">
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept={callModeEnabled ? "image/*,audio/*" : "image/*"}
                  multiple
                  onChange={(e) => {
                    if (!e.target.files) return
                    processSelectedFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  title={callModeEnabled ? "Attach image/audio" : "Attach image"}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="w-4 h-4" />
                </Button>
                {callModeEnabled && (
                  <Button
                    type="button"
                    variant={callStatus === 'recording' ? 'destructive' : 'outline'}
                    size="icon"
                    className="shrink-0"
                    title={callStatus === 'recording' ? 'Stop recording' : 'Start recording'}
                    disabled={isLoading || callStatus === 'sending'}
                    onClick={() => {
                      if (callStatus === 'recording') {
                        stopRecording()
                      } else {
                        void startRecording()
                      }
                    }}
                  >
                    {callStatus === 'recording' ? (
                      <StopCircle className="w-4 h-4" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </Button>
                )}
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={
                    callModeEnabled
                      ? 'Record audio with mic, then optionally add text or images...'
                      : agentModeEnabled && selectedTools.size > 0
                      ? 'Ask me anything... (agent mode enabled)'
                      : 'Type a message... (paste or drop images)'
                  }
                  className="min-h-[44px] leading-5"
                  rows={1}
                />
                {isLoading && callModeEnabled ? (
                  <Button
                    type="button"
                    disabled
                    className="shrink-0"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </Button>
                ) : isLoading ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className="shrink-0"
                    onClick={stopAgent}
                  >
                    <StopCircle className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={
                      isLoading ||
                      !selectedModel ||
                      !selectedModelIsSelectable ||
                      (callModeEnabled
                        ? !pendingAudio
                        : (!input.trim() && pendingImages.length === 0))
                    }
                    className="shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                )}
              </form>
              <p className="text-2xs text-muted-foreground mt-2 text-center font-mono">
                Enter to send | Shift+Enter for new line
                {agentModeEnabled && ' | Agent mode: max 10 iterations'}
                {callModeEnabled && ' | Call mode: record, then send'}
              </p>
              {callModeEnabled && (
                <p className="text-2xs text-muted-foreground mt-1 text-center font-mono">
                  Status: {callStatus}
                </p>
              )}
              {callError && (
                <p className="text-2xs text-destructive mt-1 text-center font-mono">
                  {callError}
                </p>
              )}
            </div>
          </div>

          {/* Tool Picker Sidebar */}
          {agentModeEnabled && showToolPicker && (
            <aside className="w-72 border-l border-border flex flex-col shrink-0 animate-slide-in-right">
              <ToolPicker
                selectedTools={selectedTools}
                onToolsChange={setSelectedTools}
                className="h-full"
              />
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

// Enhanced stream function that captures tool calls
async function* streamChatCompletionWithTools(
  request: {
    model: string
    messages: ApiChatMessage[]
    temperature?: number
    top_p?: number
    max_tokens?: number
    presence_penalty?: number
    frequency_penalty?: number
    seed?: number
    stop?: string | string[]
    tools?: unknown[]
    tool_choice?: unknown
  },
  signal: AbortSignal,
  onToolCalls: (toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>) => void
): AsyncGenerator<string, void, unknown> {
  // Build request body, omitting tools/tool_choice if not present
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream: true,
    temperature: request.temperature,
    top_p: request.top_p,
    max_tokens: request.max_tokens,
    presence_penalty: request.presence_penalty,
    frequency_penalty: request.frequency_penalty,
    seed: request.seed,
    stop: request.stop,
  }
  
  // Only include tools if we have them
  // Note: We don't send tool_choice by default as many backends (like vLLM)
  // require special configuration for it. Models will still use tools if provided.
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools
    // Uncomment if your backend supports tool_choice:
    // if (request.tool_choice) {
    //   body.tool_choice = request.tool_choice
    // }
  }
  
  const response = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  const toolCallsMap = new Map<number, { id: string; function: { name: string; arguments: string } }>()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') {
          // Finalize tool calls
          if (toolCallsMap.size > 0) {
            onToolCalls(Array.from(toolCallsMap.values()))
          }
          return
        }
        
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta
          
          // Handle text content
          if (delta?.content) {
            yield delta.content
          }
          
          // Handle tool calls (accumulated across chunks)
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0
              const existing = toolCallsMap.get(index)
              
              if (!existing) {
                toolCallsMap.set(index, {
                  id: tc.id || '',
                  function: {
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  },
                })
              } else {
                if (tc.id) existing.id = tc.id
                if (tc.function?.name) existing.function.name += tc.function.name
                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
              }
            }
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }

  // Finalize any remaining tool calls
  if (toolCallsMap.size > 0) {
    onToolCalls(Array.from(toolCallsMap.values()))
  }
}
