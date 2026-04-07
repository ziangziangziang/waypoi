import { useEffect, useState, useCallback } from 'react'
import {
  Settings as SettingsIcon,
  ExternalLink,
  Image as ImageIcon,
  Check,
  Server,
  Code2,
  ChevronDown,
  ChevronUp,
  Plus,
  Pencil,
  Trash2,
  Power,
  X,
  Plug,
  RefreshCw,
  Search,
  Cpu,
  Palette,
  Headphones,
  BarChart3,
  AlertCircle,
  Layers,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EndpointUsageGuide } from '@/components/EndpointUsageGuide'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  addProvider,
  addProviderModel,
  deleteProvider,
  deleteProviderModel,
  discoverProviderModels,
  type DiscoveredProviderModel,
  disableProvider,
  disableProviderModel,
  enableProvider,
  enableProviderModel,
  getAdminMeta,
  listProviders,
  listProtocols,
  updateProvider,
  updateProviderModel,
  type Provider,
  type ProviderModel,
  type ProtocolInfo,
  type EndpointType,
  type ModelModality,
  listMcpServers,
  addMcpServer,
  deleteMcpServer,
  updateMcpServer,
  connectMcpServer,
  type McpServer,
  listVirtualModels,
  createVirtualModel,
  updateVirtualModel,
  deleteVirtualModel,
  toggleVirtualModel,
  type VirtualModel,
} from '@/api/client'
import {
  loadSettings,
  updateSetting,
  IMAGE_SIZE_OPTIONS,
  type ImageSize,
  type UserSettings,
} from '@/stores/settings'

const ENDPOINT_OPTIONS: EndpointType[] = ['llm', 'diffusion', 'audio', 'embedding']
const MODALITY_OPTIONS: ModelModality[] = ['text', 'image', 'audio', 'embedding']

type ProviderFormValues = {
  id: string
  name: string
  baseUrl: string
  protocol: string
  enabled: boolean
  supportsRouting: boolean
  apiKey: string
  description: string
  docs: string
  insecureTls: boolean
  autoInsecureTlsDomains: string
  envVar: string
  authType: 'bearer' | 'query' | 'header' | 'none'
  keyParam: string
  headerName: string
  keyPrefix: string
  protocolConfigText: string
  limitsText: string
}

type RateLimitRule = {
  type: 'requests' | 'tokens'
  value: string
  unit: 'minute' | 'hour' | 'day' | 'week'
}

type ModelFormValues = {
  providerId: string
  modelId: string
  upstreamModel: string
  endpointType: EndpointType
  enabled: boolean
  baseUrl: string
  apiKey: string
  insecureTls: boolean
  aliases: string
  modalities: string
  inputCapabilities: string
  outputCapabilities: string
  supportsTools: boolean
  supportsStreaming: boolean
  limitsText: string
  rateLimitRules: RateLimitRule[]
}

export function Settings() {
  const [settings, setSettings] = useState<UserSettings>(loadSettings)
  const [providers, setProviders] = useState<Provider[]>([])
  const [virtualModels, setVirtualModels] = useState<VirtualModel[]>([])
  const [version, setVersion] = useState<string>('0.0.0')
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())
  const [isLoadingProviders, setIsLoadingProviders] = useState(true)
  const [providerError, setProviderError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [providerForm, setProviderForm] = useState<{ mode: 'create' | 'edit'; initial?: Provider } | null>(null)
  const [modelForm, setModelForm] = useState<{ provider: Provider; initial?: ProviderModel } | null>(null)
  const [vmForm, setVmForm] = useState<{ mode: 'create' | 'edit'; initial?: VirtualModel } | null>(null)

  const handleImageSizeChange = (size: ImageSize) => {
    const updated = updateSetting('defaultImageSize', size)
    setSettings(updated)
  }

  const loadData = async () => {
    setIsLoadingProviders(true)
    setProviderError(null)
    try {
      const [providerData, meta, vmData] = await Promise.all([listProviders(), getAdminMeta(), listVirtualModels()])
      setProviders(providerData)
      setVirtualModels(vmData)
      setVersion(meta.version)
      setExpandedProviders((previous) => {
        const next = new Set<string>()
        for (const provider of providerData) {
          if (previous.has(provider.id)) next.add(provider.id)
        }
        return next
      })
    } catch (error) {
      setProviderError(getErrorMessage(error, 'Failed to load providers'))
    } finally {
      setIsLoadingProviders(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const toggleProvider = (providerId: string) => {
    setExpandedProviders((previous) => {
      const next = new Set(previous)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
  }

  const runProviderAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key)
    setProviderError(null)
    try {
      await action()
      await loadData()
    } catch (error) {
      setProviderError(getErrorMessage(error, 'Provider update failed'))
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      <header className="sticky top-0 z-20 h-14 border-b border-border bg-background/95 backdrop-blur flex items-center px-6 gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <SettingsIcon className="w-4 h-4 text-primary" />
          <h2 className="font-mono font-semibold text-sm uppercase tracking-wider">Settings</h2>
        </div>
      </header>

      <div className="flex-1 min-h-0 p-6 overflow-auto">
        <div className="max-w-5xl space-y-6">
          <div className="panel">
            <div className="panel-header">
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
              <span className="panel-title">Image Generation</span>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-sm font-medium block mb-2">Default Image Size</label>
                <p className="text-xs text-muted-foreground mb-3">
                  Used when generating images via diffusion models. Can be overridden per-request in the playground.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {IMAGE_SIZE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleImageSizeChange(option.value)}
                      className={cn(
                        'relative flex flex-col items-center p-3 rounded-lg border transition-all text-left',
                        settings.defaultImageSize === option.value
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-primary/50 hover:bg-secondary/50'
                      )}
                    >
                      {settings.defaultImageSize === option.value && (
                        <div className="absolute top-1.5 right-1.5">
                          <Check className="w-3.5 h-3.5 text-primary" />
                        </div>
                      )}
                      <span className="font-mono text-sm font-medium">{option.label}</span>
                      <span className="text-2xs text-muted-foreground">{option.aspect}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <Server className="w-4 h-4 text-muted-foreground" />
              <span className="panel-title">Providers & Models</span>
              <span className="text-2xs text-muted-foreground ml-auto">{providers.length} providers</span>
              <Button size="sm" variant="outline" onClick={() => setProviderForm({ mode: 'create' })}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add Provider
              </Button>
            </div>
            <div className="p-4 space-y-4">
              {providerError && (
                <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {providerError}
                </div>
              )}
              {isLoadingProviders && <div className="text-sm text-muted-foreground">Loading providers…</div>}
              {!isLoadingProviders && providers.length === 0 && (
                <div className="rounded border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  No providers configured.
                </div>
              )}
              {providers.map((provider) => {
                const enabledModels = provider.models.filter((model) => model.enabled !== false)
                const isOpen = expandedProviders.has(provider.id)
                return (
                  <div key={provider.id} className="rounded-lg border border-border overflow-hidden">
                    <div className="px-4 py-3 flex items-start gap-3">
                      <button
                        onClick={() => toggleProvider(provider.id)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <div className={cn('status-dot', provider.enabled ? 'status-dot-live' : 'status-dot-down')} />
                          <p className="font-medium text-sm">{provider.id}</p>
                          <span className="text-2xs uppercase text-muted-foreground">{provider.protocol}</span>
                        </div>
                        <p className="text-2xs text-muted-foreground truncate font-mono mt-1">{provider.baseUrl}</p>
                        <p className="text-2xs text-muted-foreground mt-1">
                          {enabledModels.length}/{provider.models.length} models enabled
                        </p>
                      </button>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyKey === `provider-toggle:${provider.id}`}
                          onClick={() =>
                            void runProviderAction(`provider-toggle:${provider.id}`, async () => {
                              if (provider.enabled) await disableProvider(provider.id)
                              else await enableProvider(provider.id)
                            })
                          }
                        >
                          <Power className="w-3.5 h-3.5 mr-1" />
                          {provider.enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setProviderForm({ mode: 'edit', initial: provider })}>
                          <Pencil className="w-3.5 h-3.5 mr-1" />
                          Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setModelForm({ provider })}>
                          <Plus className="w-3.5 h-3.5 mr-1" />
                          Add Model
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          disabled={busyKey === `provider-delete:${provider.id}`}
                          onClick={() => {
                            if (!window.confirm(`Delete provider ${provider.id} and all of its models?`)) return
                            void runProviderAction(`provider-delete:${provider.id}`, async () => {
                              await deleteProvider(provider.id)
                            })
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          Delete
                        </Button>
                        <button onClick={() => toggleProvider(provider.id)} className="p-1 text-muted-foreground">
                          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t border-border bg-secondary/10">
                        <div className="px-4 py-3 grid grid-cols-2 gap-4 text-xs">
                          <ProviderMeta label="Supports Routing" value={provider.supportsRouting ? 'Yes' : 'No'} />
                          <ProviderMeta label="Imported" value={provider.importedAt ?? 'n/a'} mono />
                          <ProviderMeta label="Auth" value={provider.auth?.type ?? 'none'} />
                          <ProviderMeta label="Env Var" value={provider.envVar || 'n/a'} mono />
                        </div>
                        {provider.warnings && provider.warnings.length > 0 && (
                          <div className="px-4 pb-3 text-xs text-amber-300 space-y-1">
                            {provider.warnings.map((warning, index) => (
                              <div key={index}>{warning}</div>
                            ))}
                          </div>
                        )}
                        <div className="px-4 pb-4 space-y-3">
                          {provider.models.length === 0 && (
                            <p className="text-xs text-muted-foreground">No models configured for this provider.</p>
                          )}
                          {provider.models.map((model) => {
                            const canonical = `${provider.id}/${model.modelId}`
                            return (
                              <div key={model.providerModelId} className="border border-border/70 rounded-md bg-background">
                                <div className="px-3 py-2 flex items-start gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <Code2 className="w-3.5 h-3.5 text-muted-foreground" />
                                      <p className="text-xs font-mono">{canonical}</p>
                                      <span className="text-2xs uppercase text-muted-foreground">{model.endpointType}</span>
                                      <span className="text-2xs text-muted-foreground">upstream {model.upstreamModel}</span>
                                    </div>
                                    <div className="text-2xs text-muted-foreground mt-1">
                                      {(model.modalities ?? []).join(', ') || 'no modalities'}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={busyKey === `model-toggle:${model.providerModelId}`}
                                      onClick={() =>
                                        void runProviderAction(`model-toggle:${model.providerModelId}`, async () => {
                                          if (model.enabled === false) await enableProviderModel(provider.id, model.providerModelId)
                                          else await disableProviderModel(provider.id, model.providerModelId)
                                        })
                                      }
                                    >
                                      <Power className="w-3.5 h-3.5 mr-1" />
                                      {model.enabled === false ? 'Enable' : 'Disable'}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setModelForm({ provider, initial: model })}>
                                      <Pencil className="w-3.5 h-3.5 mr-1" />
                                      Edit
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-destructive hover:text-destructive"
                                      disabled={busyKey === `model-delete:${model.providerModelId}`}
                                      onClick={() => {
                                        if (!window.confirm(`Delete model ${canonical}?`)) return
                                        void runProviderAction(`model-delete:${model.providerModelId}`, async () => {
                                          await deleteProviderModel(provider.id, model.providerModelId)
                                        })
                                      }}
                                    >
                                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                                      Delete
                                    </Button>
                                  </div>
                                </div>
                                <EndpointUsageGuide
                                  target={{
                                    id: model.providerModelId,
                                    type: model.endpointType,
                                    models: [
                                      { publicName: canonical },
                                      ...(model.aliases ?? []).map((alias) => ({ publicName: alias })),
                                    ],
                                  }}
                                />
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <VirtualModelsPanel
            virtualModels={virtualModels}
            providers={providers}
            onReload={() => void loadData()}
            onCreate={() => setVmForm({ mode: 'create' })}
            onEdit={(vm) => setVmForm({ mode: 'edit', initial: vm })}
          />

          <McpServersPanel />

          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">About Waypoi</span>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Waypoi is a provider-first local AI gateway. It provides an OpenAI-compatible
                API over multiple providers/models, with routing, failover, and observability.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xs font-mono uppercase text-muted-foreground">Version</p>
                  <p className="font-mono">{version}</p>
                </div>
                <div>
                  <p className="text-2xs font-mono uppercase text-muted-foreground">Config Path</p>
                  <p className="font-mono text-sm truncate">~/.config/waypoi/providers.json</p>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">CLI Commands</span>
            </div>
            <div className="p-4 space-y-3">
              <CommandRow command="waypoi providers import -f .env" description="Import providers and credentials" />
              <CommandRow command="waypoi providers" description="List providers" />
              <CommandRow command="waypoi models <providerId>" description="List models in one provider" />
              <CommandRow command="waypoi models add <providerId> ..." description="Add a provider-owned model" />
              <CommandRow command="waypoi models update <providerId> <modelRef>" description="Update model routing/capabilities/auth" />
              <CommandRow command="waypoi bench" description="Run lightweight benchmark suite" />
              <CommandRow command="waypoi chat --model smart" description="Chat from the terminal (server must be running)" />
              <CommandRow command="waypoi sessions" description="List all chat sessions" />
              <CommandRow command="waypoi sessions show <id>" description="Print message history for a session" />
              <CommandRow command="waypoi mcp add --name mytools --url http://..." description="Register an MCP server" />
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Resources</span>
            </div>
            <div className="p-4 space-y-2">
              <a
                href="https://github.com/ziangziangziang/waypoi"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                GitHub Repository
              </a>
            </div>
          </div>
        </div>
      </div>

      {providerForm && (
        <ProviderFormDialog
          title={providerForm.mode === 'create' ? 'Add Provider' : `Edit Provider ${providerForm.initial?.id}`}
          initialValues={providerForm.mode === 'create' ? emptyProviderForm() : providerToForm(providerForm.initial!)}
          isEdit={providerForm.mode === 'edit'}
          onClose={() => setProviderForm(null)}
          onSubmit={async (values) => {
            const payload = parseProviderForm(values)
            await runProviderAction(`provider-form:${values.id}`, async () => {
              if (providerForm.mode === 'create') await addProvider(payload)
              else await updateProvider(providerForm.initial!.id, payload)
            })
            setProviderForm(null)
          }}
        />
      )}

      {modelForm && (
        <ModelFormDialog
          title={modelForm.initial ? `Edit Model ${modelForm.initial.providerModelId}` : `Add Model to ${modelForm.provider.id}`}
          provider={modelForm.provider}
          allowDiscovery={!modelForm.initial}
          initialValues={modelForm.initial ? modelToForm(modelForm.provider, modelForm.initial) : emptyModelForm(modelForm.provider.id)}
          onClose={() => setModelForm(null)}
          onSubmit={async (values) => {
            const payload = parseModelForm(values)
            await runProviderAction(`model-form:${values.providerId}:${values.modelId}`, async () => {
              if (modelForm.initial) {
                await updateProviderModel(modelForm.provider.id, modelForm.initial.providerModelId, payload)
              } else {
                await addProviderModel(modelForm.provider.id, payload)
              }
            })
            setModelForm(null)
          }}
        />
      )}

      {vmForm && (
        <VirtualModelFormDialog
          title={vmForm.mode === 'create' ? 'Create Virtual Model' : `Edit Virtual Model ${vmForm.initial?.id}`}
          initialValues={vmForm.mode === 'create' ? emptyVmForm() : vmToForm(vmForm.initial!)}
          allProviderModels={providers.flatMap((p) =>
            p.models.map((m) => ({
              key: `${p.id}/${m.modelId}`,
              providerId: p.id,
              modelId: m.modelId,
              endpointType: m.endpointType,
              modalities: m.modalities ?? [],
              capabilities: m.capabilities,
            }))
          )}
          isEdit={vmForm.mode === 'edit'}
          onClose={() => setVmForm(null)}
          onSubmit={async (values) => {
            const payload = parseVmForm(values)
            if (vmForm.mode === 'create') {
              await createVirtualModel(payload)
            } else {
              await updateVirtualModel(vmForm.initial!.id, payload)
            }
            setVmForm(null)
            await loadData()
          }}
        />
      )}
    </div>
  )
}

function ProviderMeta(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-2xs font-mono uppercase text-muted-foreground">{props.label}</p>
      <p className={cn('text-sm truncate', props.mono && 'font-mono')}>{props.value}</p>
    </div>
  )
}

const OPERATION_LABELS: Record<string, string> = {
  chat_completions: 'Chat',
  embeddings: 'Embeddings',
  images_generation: 'Images',
  images_edits: 'Image Edits',
  images_variations: 'Image Vars',
  audio_transcriptions: 'Transcribe',
  audio_translations: 'Translate',
  audio_speech: 'Speech',
}

function OperationBadge({ operation }: { operation: string }) {
  const label = OPERATION_LABELS[operation] ?? operation
  return (
    <span className="text-2xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">
      {label}
    </span>
  )
}

function ProviderFormDialog(props: {
  title: string
  initialValues: ProviderFormValues
  isEdit: boolean
  onClose: () => void
  onSubmit: (values: ProviderFormValues) => Promise<void>
}) {
  const [values, setValues] = useState<ProviderFormValues>(props.initialValues)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [protocols, setProtocols] = useState<ProtocolInfo[]>([])
  const [detecting, setDetecting] = useState(false)
  const [detectResult, setDetectResult] = useState<'success' | 'warning' | 'error' | null>(null)
  const [detectMessage, setDetectMessage] = useState<string | null>(null)
  const [protocolFilter, setProtocolFilter] = useState('')

  useEffect(() => {
    void listProtocols().then(setProtocols).catch(() => {
      setProtocols([
        { id: 'openai', label: 'OpenAI Compatible', description: 'Standard OpenAI API format.', operations: ['chat_completions', 'embeddings', 'images_generation'], streamOperations: ['chat_completions', 'embeddings', 'images_generation'], supportsRouting: true },
        { id: 'inference_v2', label: 'Inference V2 (KServe/Ray)', description: 'KServe v2 / Ray Serve inference format.', operations: ['chat_completions'], streamOperations: [], supportsRouting: true },
      ])
    })
  }, [])

  const setField = <K extends keyof ProviderFormValues>(key: K, value: ProviderFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  useEffect(() => {
    if (!props.isEdit && values.id && !values.name) {
      setValues((current) => ({ ...current, name: current.id }))
    }
  }, [values.id, values.name, props.isEdit])

  const handleProtocolSelect = (protocolId: string) => {
    const proto = protocols.find((p) => p.id === protocolId)
    setValues((current) => ({
      ...current,
      protocol: protocolId,
      supportsRouting: proto?.supportsRouting ?? current.supportsRouting,
    }))
  }

  const handleAutoDetect = async () => {
    if (!values.baseUrl.trim()) {
      setDetectResult('error')
      setDetectMessage('Enter a Base URL first')
      return
    }
    setDetecting(true)
    setDetectResult(null)
    setDetectMessage(null)
    setError(null)
    try {
      const normalizedBaseUrl = values.baseUrl.trim().replace(/\/+$/, '')
      const headers: Record<string, string> = {}
      if (values.apiKey.trim()) {
        headers.authorization = `Bearer ${values.apiKey.trim()}`
      }

      let detected: string | null = null
      let confidence: 'high' | 'low' = 'low'
      try {
        const v1Resp = await fetch(`${normalizedBaseUrl}/v1/models`, { headers })
        if (v1Resp.ok) {
          const json = await v1Resp.json()
          if (json && typeof json === 'object' && Array.isArray((json as { data?: unknown }).data)) {
            detected = 'openai'
            confidence = 'high'
          }
        } else if (v1Resp.status === 401 || v1Resp.status === 403) {
          detected = 'openai'
          confidence = 'low'
        }
      } catch {
        // ignore
      }

      if (!detected) {
        try {
          const v2Resp = await fetch(`${normalizedBaseUrl}/v2/models`, { headers })
          if (v2Resp.ok) {
            detected = 'inference_v2'
            confidence = 'high'
          }
        } catch {
          // ignore
        }
      }

      if (detected && protocols.some((p) => p.id === detected)) {
        handleProtocolSelect(detected)
        setDetectResult(confidence === 'high' ? 'success' : 'warning')
        const label = protocols.find((p) => p.id === detected)?.label ?? detected
        setDetectMessage(confidence === 'high' ? `Detected: ${label}` : `Likely ${label} (auth required to confirm)`)
      } else if (detected) {
        setField('protocol', detected)
        setDetectResult('warning')
        setDetectMessage(`Detected: ${detected} (not in registry)`)
      } else {
        setDetectResult('error')
        setDetectMessage('Could not detect API format. Select manually below.')
      }
    } catch (err) {
      setDetectResult('error')
      setDetectMessage('Detection failed. Select manually.')
    } finally {
      setDetecting(false)
    }
  }

  const filteredProtocols = protocols.filter((p) =>
    p.label.toLowerCase().includes(protocolFilter.toLowerCase()) ||
    p.description.toLowerCase().includes(protocolFilter.toLowerCase())
  )

  return (
    <Overlay title={props.title} onClose={props.onClose}>
      <div className="space-y-4">
        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <LabeledField label="Provider ID" description="Unique identifier, e.g. openrouter">
            <Input value={values.id} onChange={(event) => setField('id', event.target.value)} disabled={props.isEdit} />
          </LabeledField>
          <LabeledField label="Display Name" description="Friendly name (auto-filled from ID)">
            <Input value={values.name} onChange={(event) => setField('name', event.target.value)} />
          </LabeledField>
        </div>

        <LabeledField
          label="Base URL"
          description={
            <>
              <span className="block font-mono">Examples: https://api.openai.com/v1, http://localhost:11434</span>
              <span className="block">Discovery uses <code>/v1/models</code>, so root URLs and URLs already ending in <code>/v1</code> both work.</span>
            </>
          }
        >
          <div className="flex gap-2">
            <Input className="flex-1" value={values.baseUrl} onChange={(event) => setField('baseUrl', event.target.value)} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleAutoDetect()}
              disabled={detecting}
              className="shrink-0 whitespace-nowrap"
            >
              <Search className="w-3.5 h-3.5 mr-1" />
              {detecting ? 'Detecting…' : 'Auto-Detect'}
            </Button>
          </div>
        </LabeledField>

        {detectResult && (
          <div className={cn(
            'flex items-center gap-2 rounded border px-3 py-2 text-xs',
            detectResult === 'success' && 'border-green-500/40 bg-green-500/10 text-green-400',
            detectResult === 'warning' && 'border-amber-500/40 bg-amber-500/10 text-amber-400',
            detectResult === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
          )}>
            {detectResult === 'success' && <Check className="w-3.5 h-3.5 shrink-0" />}
            {detectResult === 'warning' && <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
            {detectResult === 'error' && <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
            {detectMessage}
          </div>
        )}

        <div>
          <label className="block space-y-1">
            <span className="text-xs font-mono uppercase text-muted-foreground">API Format</span>
            <span className="block text-xs text-muted-foreground">Select the API format this provider uses.</span>
          </label>
          {protocols.length > 4 && (
            <Input
              className="mt-2 h-8 text-sm"
              placeholder="Search formats…"
              value={protocolFilter}
              onChange={(e) => setProtocolFilter(e.target.value)}
            />
          )}
          <div className={cn('grid gap-2 mt-2', protocols.length > 2 ? 'grid-cols-2' : 'grid-cols-1')}>
            {filteredProtocols.map((proto) => {
              const isSelected = proto.id === values.protocol
              return (
                <button
                  key={proto.id}
                  type="button"
                  onClick={() => handleProtocolSelect(proto.id)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-all',
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-primary/50 hover:bg-secondary/50'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
                      <span className="font-medium text-sm">{proto.label}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={cn('text-2xs px-1.5 py-0.5 rounded', proto.supportsRouting ? 'bg-green-500/10 text-green-400' : 'bg-muted text-muted-foreground')}>
                        Routing
                      </span>
                      {proto.streamOperations.length > 0 && (
                        <span className="text-2xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                          Stream
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{proto.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {proto.operations.slice(0, 4).map((op) => (
                      <OperationBadge key={op} operation={op} />
                    ))}
                    {proto.operations.length > 4 && (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                        +{proto.operations.length - 4}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
          {protocolFilter && filteredProtocols.length === 0 && (
            <p className="text-xs text-muted-foreground mt-2">No formats match "{protocolFilter}"</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ToggleField label="Enabled" checked={values.enabled} onChange={(checked) => setField('enabled', checked)} />
          <LabeledField label="API Key Override">
            <Input value={values.apiKey} onChange={(event) => setField('apiKey', event.target.value)} />
          </LabeledField>
        </div>

        <details className="rounded border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Advanced Provider Fields</summary>
          <div className="space-y-3 mt-3">
            <div className="grid grid-cols-2 gap-3">
              <ToggleField label="Insecure TLS" checked={values.insecureTls} onChange={(checked) => setField('insecureTls', checked)} />
              <LabeledField label="Env Var">
                <Input value={values.envVar} onChange={(event) => setField('envVar', event.target.value)} />
              </LabeledField>
              <LabeledField label="Docs URL">
                <Input value={values.docs} onChange={(event) => setField('docs', event.target.value)} />
              </LabeledField>
              <LabeledField label="Auth Type">
                <select className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm" value={values.authType} onChange={(event) => setField('authType', event.target.value as ProviderFormValues['authType'])}>
                  <option value="bearer">bearer</option>
                  <option value="header">header</option>
                  <option value="query">query</option>
                  <option value="none">none</option>
                </select>
              </LabeledField>
              <LabeledField label="Header Name">
                <Input value={values.headerName} onChange={(event) => setField('headerName', event.target.value)} />
              </LabeledField>
              <LabeledField label="Query Param">
                <Input value={values.keyParam} onChange={(event) => setField('keyParam', event.target.value)} />
              </LabeledField>
              <LabeledField label="Key Prefix">
                <Input value={values.keyPrefix} onChange={(event) => setField('keyPrefix', event.target.value)} />
              </LabeledField>
              <LabeledField label="Auto Insecure TLS Domains (comma-separated)">
                <Input value={values.autoInsecureTlsDomains} onChange={(event) => setField('autoInsecureTlsDomains', event.target.value)} />
              </LabeledField>
            </div>
            <LabeledField label="Description">
              <Textarea value={values.description} onChange={(event) => setField('description', event.target.value)} rows={3} />
            </LabeledField>
            <LabeledField label="Protocol Config (JSON)">
              <Textarea value={values.protocolConfigText} onChange={(event) => setField('protocolConfigText', event.target.value)} rows={4} />
            </LabeledField>
            <LabeledField label="Limits (JSON)">
              <Textarea value={values.limitsText} onChange={(event) => setField('limitsText', event.target.value)} rows={4} />
            </LabeledField>
          </div>
        </details>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={props.onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={async () => {
              setSaving(true)
              setError(null)
              try {
                await props.onSubmit(values)
              } catch (err) {
                setError(getErrorMessage(err, 'Failed to save provider'))
              } finally {
                setSaving(false)
              }
            }}
            disabled={saving}
          >
            Save Provider
          </Button>
        </div>
      </div>
    </Overlay>
  )
}

const ENDPOINT_TYPE_INFO: Record<EndpointType, { label: string; description: string; icon: typeof Cpu }> = {
  llm: { label: 'LLM', description: 'Text generation, chat, reasoning', icon: Cpu },
  diffusion: { label: 'Image', description: 'Image generation and editing', icon: Palette },
  audio: { label: 'Audio', description: 'Speech-to-text, text-to-speech', icon: Headphones },
  embedding: { label: 'Embedding', description: 'Vector embeddings for search/RAG', icon: BarChart3 },
}

function ModelFormDialog(props: {
  title: string
  provider: Provider
  allowDiscovery: boolean
  initialValues: ModelFormValues
  onClose: () => void
  onSubmit: (values: ModelFormValues) => Promise<void>
}) {
  const [values, setValues] = useState<ModelFormValues>(props.initialValues)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [discoveryBaseUrl, setDiscoveryBaseUrl] = useState<string | null>(null)
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredProviderModel[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)

  const setField = <K extends keyof ModelFormValues>(key: K, value: ModelFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const handleDiscovery = async () => {
    setDiscovering(true)
    setDiscoveryError(null)
    try {
      const response = await discoverProviderModels(props.provider.id, {
        baseUrl: values.baseUrl.trim() || undefined,
        apiKey: values.apiKey.trim() || undefined,
        insecureTls: values.insecureTls || undefined,
      })
      setDiscoveryBaseUrl(response.baseUrl)
      setDiscoveredModels(response.models)
    } catch (err) {
      setDiscoveryError(getErrorMessage(err, 'Failed to discover models'))
    } finally {
      setDiscovering(false)
    }
  }

  const applyDiscoveredModel = (model: DiscoveredProviderModel) => {
    setValues((current) => {
      const next: ModelFormValues = {
        ...current,
        modelId: model.id,
        upstreamModel: model.id,
      }
      if (!model.capabilities) {
        return next
      }
      if (model.capabilities.input.length > 0) {
        next.inputCapabilities = model.capabilities.input.join(', ')
      }
      if (model.capabilities.output.length > 0) {
        next.outputCapabilities = model.capabilities.output.join(', ')
        next.endpointType = inferEndpointType(model.capabilities.output)
      }
      const modalities = mergeModalities(model.capabilities)
      if (modalities.length > 0) {
        next.modalities = modalities.join(', ')
      }
      if (typeof model.capabilities.supportsTools === 'boolean') {
        next.supportsTools = model.capabilities.supportsTools
      }
      if (typeof model.capabilities.supportsStreaming === 'boolean') {
        next.supportsStreaming = model.capabilities.supportsStreaming
      }
      return next
    })
  }

  const toggleModality = (field: 'inputCapabilities' | 'outputCapabilities', modality: ModelModality) => {
    const current = new Set(parseCommaList(values[field]))
    if (current.has(modality)) current.delete(modality)
    else current.add(modality)
    setField(field, Array.from(current).join(', '))
  }

  const inputModalities = new Set(parseCommaList(values.inputCapabilities))
  const outputModalities = new Set(parseCommaList(values.outputCapabilities))

  return (
    <Overlay title={props.title} onClose={props.onClose}>
      <div className="space-y-4">
        {error && <div className="text-sm text-destructive">{error}</div>}

        {props.allowDiscovery && (
          <div className="rounded border border-border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Discover Models</p>
                <p className="text-xs text-muted-foreground">
                  Fetch available models from <code>/v1/models</code>. Pick one to auto-fill the form.
                </p>
              </div>
              <Button variant="outline" onClick={() => void handleDiscovery()} disabled={discovering || saving}>
                {discovering ? 'Discovering…' : 'Discover'}
              </Button>
            </div>
            {discoveryError && <div className="text-sm text-destructive">{discoveryError}</div>}
            {discoveryBaseUrl && (
              <div className="text-xs text-muted-foreground">
                Source: <code>{discoveryBaseUrl}</code>
              </div>
            )}
            {discoveryBaseUrl && discoveredModels.length === 0 && !discoveryError && (
              <div className="text-sm text-muted-foreground">No models returned by upstream <code>/v1/models</code>.</div>
            )}
            {discoveredModels.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-auto pr-1">
                {discoveredModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => applyDiscoveredModel(model)}
                    className="w-full rounded border border-border px-3 py-2 text-left hover:border-primary/50 hover:bg-secondary/40 transition-colors"
                  >
                    <div className="font-mono text-sm">{model.id}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDiscoveryCapabilities(model)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <LabeledField label="Model ID" description="The model identifier used in API requests">
            <Input
              value={values.modelId}
              onChange={(event) => {
                const v = event.target.value
                setValues((current) => ({
                  ...current,
                  modelId: v,
                  upstreamModel: current.upstreamModel === current.modelId ? v : current.upstreamModel,
                }))
              }}
            />
          </LabeledField>
          <LabeledField label="Endpoint Type">
            <div className="grid grid-cols-2 gap-1.5">
              {ENDPOINT_OPTIONS.map((option) => {
                const info = ENDPOINT_TYPE_INFO[option]
                const Icon = info.icon
                const isSelected = values.endpointType === option
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setField('endpointType', option)}
                    className={cn(
                      'flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs transition-all',
                      isSelected
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border hover:border-primary/50 text-muted-foreground'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-medium">{info.label}</span>
                  </button>
                )
              })}
            </div>
          </LabeledField>
        </div>

        <div>
          <label className="block">
            <span className="text-xs font-mono uppercase text-muted-foreground">Capabilities</span>
          </label>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div className="rounded border border-border p-2.5 space-y-1.5">
              <p className="text-2xs font-mono uppercase text-muted-foreground">Input</p>
              <div className="flex flex-wrap gap-1.5">
                {MODALITY_OPTIONS.map((m) => {
                  const active = inputModalities.has(m)
                  return (
                    <button
                      key={`in-${m}`}
                      type="button"
                      onClick={() => toggleModality('inputCapabilities', m)}
                      className={cn(
                        'text-xs px-2 py-1 rounded border transition-all',
                        active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                      )}
                    >
                      {m}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="rounded border border-border p-2.5 space-y-1.5">
              <p className="text-2xs font-mono uppercase text-muted-foreground">Output</p>
              <div className="flex flex-wrap gap-1.5">
                {MODALITY_OPTIONS.map((m) => {
                  const active = outputModalities.has(m)
                  return (
                    <button
                      key={`out-${m}`}
                      type="button"
                      onClick={() => toggleModality('outputCapabilities', m)}
                      className={cn(
                        'text-xs px-2 py-1 rounded border transition-all',
                        active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                      )}
                    >
                      {m}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ToggleField label="Enabled" checked={values.enabled} onChange={(checked) => setField('enabled', checked)} />
          <ToggleField label="Supports Tools" checked={values.supportsTools} onChange={(checked) => setField('supportsTools', checked)} />
          <ToggleField label="Supports Streaming" checked={values.supportsStreaming} onChange={(checked) => setField('supportsStreaming', checked)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <LabeledField label="API Key Override">
            <Input value={values.apiKey} onChange={(event) => setField('apiKey', event.target.value)} />
          </LabeledField>
          <LabeledField label="Base URL Override">
            <Input value={values.baseUrl} onChange={(event) => setField('baseUrl', event.target.value)} />
          </LabeledField>
        </div>

        {!showAdvanced ? (
          <button
            type="button"
            onClick={() => setShowAdvanced(true)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Show advanced options (upstream override, aliases, rate limits…)
          </button>
        ) : (
          <details open className="rounded border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">Advanced Model Fields</summary>
            <div className="space-y-3 mt-3">
              <div className="grid grid-cols-2 gap-3">
                <ToggleField label="Insecure TLS" checked={values.insecureTls} onChange={(checked) => setField('insecureTls', checked)} />
                <LabeledField label="Upstream Model Override">
                  <Input value={values.upstreamModel} onChange={(event) => setField('upstreamModel', event.target.value)} />
                </LabeledField>
                <LabeledField label="Aliases (comma-separated)">
                  <Input value={values.aliases} onChange={(event) => setField('aliases', event.target.value)} />
                </LabeledField>
                <LabeledField label="Modalities (comma-separated)">
                  <Input value={values.modalities} onChange={(event) => setField('modalities', event.target.value)} placeholder={MODALITY_OPTIONS.join(', ')} />
                </LabeledField>
              </div>

              <div>
                <label className="block">
                  <span className="text-xs font-mono uppercase text-muted-foreground">Rate Limits</span>
                </label>
                <div className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setField('rateLimitRules', [...values.rateLimitRules, { type: 'requests' as const, value: '', unit: 'minute' as const }])}
                    className="mb-2"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Add Rule
                  </Button>
                  {values.rateLimitRules.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-12 gap-2 text-2xs font-mono uppercase text-muted-foreground px-1">
                        <div className="col-span-3">Type</div>
                        <div className="col-span-3">Value</div>
                        <div className="col-span-4">Window</div>
                        <div className="col-span-2"></div>
                      </div>
                      {values.rateLimitRules.map((rule, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-3">
                            <select
                              className="w-full h-8 rounded border border-input bg-transparent px-2 text-xs"
                              value={rule.type}
                              onChange={(e) => {
                                const rules = [...values.rateLimitRules]
                                rules[idx] = { ...rule, type: e.target.value as 'requests' | 'tokens' }
                                setField('rateLimitRules', rules)
                              }}
                            >
                              <option value="requests">Requests</option>
                              <option value="tokens">Tokens</option>
                            </select>
                          </div>
                          <div className="col-span-3">
                            <Input
                              className="h-8 text-xs"
                              type="number"
                              value={rule.value}
                              onChange={(e) => {
                                const rules = [...values.rateLimitRules]
                                rules[idx] = { ...rule, value: e.target.value }
                                setField('rateLimitRules', rules)
                              }}
                              placeholder="0"
                            />
                          </div>
                          <div className="col-span-4">
                            <select
                              className="w-full h-8 rounded border border-input bg-transparent px-2 text-xs"
                              value={rule.unit}
                              onChange={(e) => {
                                const rules = [...values.rateLimitRules]
                                rules[idx] = { ...rule, unit: e.target.value as RateLimitRule['unit'] }
                                setField('rateLimitRules', rules)
                              }}
                            >
                              <option value="minute">per minute</option>
                              <option value="hour">per hour</option>
                              <option value="day">per day</option>
                              <option value="week">per week</option>
                            </select>
                          </div>
                          <div className="col-span-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                const rules = values.rateLimitRules.filter((_, i) => i !== idx)
                                setField('rateLimitRules', rules)
                              }}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <LabeledField label="Limits (JSON, overrides above)">
                <Textarea value={values.limitsText} onChange={(event) => setField('limitsText', event.target.value)} rows={4} />
              </LabeledField>
            </div>
          </details>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={props.onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={async () => {
              setSaving(true)
              setError(null)
              try {
                await props.onSubmit(values)
              } catch (err) {
                setError(getErrorMessage(err, 'Failed to save model'))
              } finally {
                setSaving(false)
              }
            }}
            disabled={saving}
          >
            Save Model
          </Button>
        </div>
      </div>
    </Overlay>
  )
}

function Overlay(props: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-start justify-center p-6 overflow-auto">
      <div className="w-full max-w-3xl rounded-lg border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-mono font-semibold text-sm uppercase tracking-wider">{props.title}</h3>
          <button onClick={props.onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">{props.children}</div>
      </div>
    </div>
  )
}

function LabeledField(props: { label: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-mono uppercase text-muted-foreground">{props.label}</span>
      {props.description && <span className="block text-xs text-muted-foreground">{props.description}</span>}
      {props.children}
    </label>
  )
}

function ToggleField(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm">
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} />
      <span>{props.label}</span>
    </label>
  )
}

function CommandRow({ command, description }: { command: string; description: string }) {
  return (
    <div className="flex items-center gap-4">
      <code className="font-mono text-sm bg-input px-2 py-1 rounded flex-shrink-0">
        {command}
      </code>
      <span className="text-sm text-muted-foreground">{description}</span>
    </div>
  )
}

function emptyProviderForm(): ProviderFormValues {
  return {
    id: '',
    name: '',
    baseUrl: '',
    protocol: 'openai',
    enabled: true,
    supportsRouting: true,
    apiKey: '',
    description: '',
    docs: '',
    insecureTls: false,
    autoInsecureTlsDomains: '',
    envVar: '',
    authType: 'bearer',
    keyParam: '',
    headerName: '',
    keyPrefix: '',
    protocolConfigText: '',
    limitsText: '',
  }
}

function providerToForm(provider: Provider): ProviderFormValues {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol,
    enabled: provider.enabled,
    supportsRouting: provider.supportsRouting,
    apiKey: provider.apiKey ?? '',
    description: provider.description ?? '',
    docs: provider.docs ?? '',
    insecureTls: provider.insecureTls === true,
    autoInsecureTlsDomains: (provider.autoInsecureTlsDomains ?? []).join(', '),
    envVar: provider.envVar ?? '',
    authType: provider.auth?.type ?? 'none',
    keyParam: provider.auth?.keyParam ?? '',
    headerName: provider.auth?.headerName ?? '',
    keyPrefix: provider.auth?.keyPrefix ?? '',
    protocolConfigText: provider.protocolConfig ? JSON.stringify(provider.protocolConfig, null, 2) : '',
    limitsText: provider.limits ? JSON.stringify(provider.limits, null, 2) : '',
  }
}

function emptyModelForm(providerId: string): ModelFormValues {
  return {
    providerId,
    modelId: '',
    upstreamModel: '',
    endpointType: 'llm',
    enabled: true,
    baseUrl: '',
    apiKey: '',
    insecureTls: false,
    aliases: '',
    modalities: 'text',
    inputCapabilities: 'text',
    outputCapabilities: 'text',
    supportsTools: false,
    supportsStreaming: false,
    limitsText: '',
    rateLimitRules: [],
  }
}

function modelToForm(provider: Provider, model: ProviderModel): ModelFormValues {
  const rateLimitRules: RateLimitRule[] = []
  if (model.limits) {
    const unitMap: Record<string, 'minute' | 'hour' | 'day' | 'week'> = {
      perMinute: 'minute', perHour: 'hour', perDay: 'day', perWeek: 'week', perMonth: 'day',
    }
    for (const [key, val] of Object.entries(model.limits.requests ?? {})) {
      if (typeof val === 'number') {
        rateLimitRules.push({ type: 'requests', value: String(val), unit: unitMap[key] ?? 'minute' })
      }
    }
    for (const [key, val] of Object.entries(model.limits.tokens ?? {})) {
      if (typeof val === 'number') {
        rateLimitRules.push({ type: 'tokens', value: String(val), unit: unitMap[key] ?? 'minute' })
      }
    }
  }
  return {
    providerId: provider.id,
    modelId: model.modelId,
    upstreamModel: model.upstreamModel,
    endpointType: model.endpointType,
    enabled: model.enabled !== false,
    baseUrl: model.baseUrl ?? '',
    apiKey: model.apiKey ?? '',
    insecureTls: model.insecureTls === true,
    aliases: (model.aliases ?? []).join(', '),
    modalities: (model.modalities ?? []).join(', '),
    inputCapabilities: (model.capabilities.input ?? []).join(', '),
    outputCapabilities: (model.capabilities.output ?? []).join(', '),
    supportsTools: model.capabilities.supportsTools === true,
    supportsStreaming: model.capabilities.supportsStreaming === true,
    limitsText: model.limits ? JSON.stringify(model.limits, null, 2) : '',
    rateLimitRules,
  }
}

function parseProviderForm(values: ProviderFormValues) {
  if (!values.id.trim() || !values.baseUrl.trim() || !values.protocol.trim()) {
    throw new Error('Provider ID, base URL, and protocol are required')
  }
  const protocolConfig = values.protocolConfigText.trim() ? parseJson(values.protocolConfigText, 'provider protocol config') : undefined
  const limits = values.limitsText.trim() ? parseJson(values.limitsText, 'provider limits') : undefined
  return {
    id: values.id.trim(),
    name: values.name.trim() || values.id.trim(),
    baseUrl: values.baseUrl.trim(),
    protocol: values.protocol.trim(),
    enabled: values.enabled,
    supportsRouting: values.supportsRouting,
    apiKey: values.apiKey.trim() || undefined,
    description: values.description.trim() || undefined,
    docs: values.docs.trim() || undefined,
    insecureTls: values.insecureTls || undefined,
    autoInsecureTlsDomains: parseCommaList(values.autoInsecureTlsDomains),
    envVar: values.envVar.trim() || undefined,
    auth: values.authType === 'none'
      ? undefined
      : {
          type: values.authType,
          keyParam: values.keyParam.trim() || undefined,
          headerName: values.headerName.trim() || undefined,
          keyPrefix: values.keyPrefix.trim() || undefined,
        },
    protocolConfig,
    limits,
  }
}

function parseModelForm(values: ModelFormValues) {
  if (!values.modelId.trim() || !values.upstreamModel.trim()) {
    throw new Error('Model ID and upstream model are required')
  }
  const input = parseModalities(values.inputCapabilities, 'input capabilities')
  const output = parseModalities(values.outputCapabilities, 'output capabilities')
  const modalities = parseModalities(values.modalities, 'modalities')
  const limitsFromText = values.limitsText.trim() ? parseJson(values.limitsText, 'model limits') : undefined
  const unitMap: Record<string, string> = {
    minute: 'perMinute', hour: 'perHour', day: 'perDay', week: 'perWeek',
  }
  const limits: Record<string, unknown> = limitsFromText ?? {}
  const rules = values.rateLimitRules.filter((r) => r.value.trim())
  if (rules.length > 0) {
    const requestLimits: Record<string, number> = {}
    const tokenLimits: Record<string, number> = {}
    for (const rule of rules) {
      const key = unitMap[rule.unit]
      if (key) {
        if (rule.type === 'requests') {
          requestLimits[key] = Number(rule.value)
        } else {
          tokenLimits[key] = Number(rule.value)
        }
      }
    }
    if (!limits.requests) limits.requests = {}
    if (!limits.tokens) limits.tokens = {}
    Object.assign(limits.requests as Record<string, unknown>, requestLimits)
    Object.assign(limits.tokens as Record<string, unknown>, tokenLimits)
  }
  return {
    modelId: values.modelId.trim(),
    upstreamModel: values.upstreamModel.trim(),
    endpointType: values.endpointType,
    enabled: values.enabled,
    baseUrl: values.baseUrl.trim(),
    apiKey: values.apiKey.trim() || undefined,
    insecureTls: values.insecureTls || undefined,
    aliases: parseCommaList(values.aliases),
    modalities,
    capabilities: {
      input,
      output,
      supportsTools: values.supportsTools || undefined,
      supportsStreaming: values.supportsStreaming || undefined,
    },
    limits: Object.keys(limits).length > 0 ? limits : undefined,
  }
}

function parseCommaList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean)
}

function parseModalities(value: string, label: string): ModelModality[] {
  const parsed = parseCommaList(value)
  const invalid = parsed.filter((part) => !MODALITY_OPTIONS.includes(part as ModelModality))
  if (invalid.length > 0) {
    throw new Error(`Invalid ${label}: ${invalid.join(', ')}`)
  }
  return parsed as ModelModality[]
}

function parseJson(value: string, label: string) {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`Invalid ${label} JSON`)
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'body' in error) {
    const body = (error as { body?: { error?: { message?: string } } }).body
    if (body?.error?.message) return body.error.message
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function mergeModalities(capabilities: { input: ModelModality[]; output: ModelModality[] }): ModelModality[] {
  return Array.from(new Set([...capabilities.input, ...capabilities.output]))
}

function inferEndpointType(output: ModelModality[]): EndpointType {
  if (output.includes('text')) return 'llm'
  if (output.includes('embedding')) return 'embedding'
  if (output.includes('image')) return 'diffusion'
  if (output.includes('audio')) return 'audio'
  return 'llm'
}

function formatDiscoveryCapabilities(model: DiscoveredProviderModel): string {
  if (!model.capabilities) {
    return 'No capability metadata returned'
  }
  const parts = [
    model.capabilities.input.length > 0 ? `input ${model.capabilities.input.join(', ')}` : null,
    model.capabilities.output.length > 0 ? `output ${model.capabilities.output.join(', ')}` : null,
    model.capabilities.supportsTools === true ? 'tools' : null,
    model.capabilities.supportsStreaming === true ? 'streaming' : null,
  ].filter(Boolean)
  return parts.join(' • ') || 'No capability metadata returned'
}

// ─────────────────────────────────────────────────────────────────────────────
// Virtual Models Panel
// ─────────────────────────────────────────────────────────────────────────────

function VirtualModelsPanel(props: {
  virtualModels: VirtualModel[]
  providers: Provider[]
  onReload: () => void
  onCreate: () => void
  onEdit: (vm: VirtualModel) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try { await fn(); props.onReload() }
    catch { /* errors handled by parent */ }
    finally { setBusy(null) }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <Layers className="w-4 h-4 text-muted-foreground" />
        <span className="panel-title">Virtual Models</span>
        <span className="text-2xs text-muted-foreground ml-auto">{props.virtualModels.length} virtual models</span>
        <Button size="sm" variant="outline" onClick={props.onCreate}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Create Virtual Model
        </Button>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Virtual models act as a single model backed by one or more real models. Useful for A/B testing and aggregating usage across providers.
        </p>
        {props.virtualModels.length === 0 && (
          <div className="rounded border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No virtual models configured.
          </div>
        )}
        {props.virtualModels.map((vm) => {
          const candidateNames = vm.candidates.map((c) => `${c.providerId}/${c.modelId}`)
          return (
            <div key={vm.id} className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className={cn('status-dot', vm.enabled ? 'status-dot-live' : 'status-dot-down')} />
                    <p className="font-medium text-sm">{vm.name}</p>
                    <span className="text-2xs uppercase text-muted-foreground">{vm.id}</span>
                  </div>
                  <p className="text-2xs text-muted-foreground mt-1">
                    {vm.candidates.length} candidate{vm.candidates.length !== 1 ? 's' : ''} · {vm.strategy.replace(/_/g, ' ')}
                  </p>
                  {candidateNames.length > 0 && (
                    <p className="text-2xs text-muted-foreground mt-0.5 truncate font-mono">
                      {candidateNames.join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === `toggle:${vm.id}`}
                    onClick={() => void run(`toggle:${vm.id}`, async () => {
                      await toggleVirtualModel(vm.id)
                    })}
                  >
                    <Power className="w-3.5 h-3.5 mr-1" />
                    {vm.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => props.onEdit(vm)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" />
                    Edit
                  </Button>
                  {vm.userDefined && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={busy === `delete:${vm.id}`}
                      onClick={() => {
                        if (!window.confirm(`Delete virtual model ${vm.id}?`)) return
                        void run(`delete:${vm.id}`, async () => {
                          await deleteVirtualModel(vm.id)
                        })
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function VirtualModelFormDialog(props: {
  title: string
  initialValues: VmFormValues
  allProviderModels: Array<{ key: string; providerId: string; modelId: string; endpointType: EndpointType; modalities: string[]; capabilities: { input: string[]; output: string[] } }>
  isEdit: boolean
  onClose: () => void
  onSubmit: (values: VmFormValues) => Promise<void>
}) {
  const [values, setValues] = useState<VmFormValues>(props.initialValues)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const setField = <K extends keyof VmFormValues>(key: K, value: VmFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const toggleCandidate = (key: string) => {
    const sel = new Set(values.candidateSelection)
    if (sel.has(key)) sel.delete(key)
    else sel.add(key)
    setField('candidateSelection', Array.from(sel))
  }

  const filteredModels = props.allProviderModels.filter((m) => {
    if (filter !== 'all' && m.endpointType !== filter) return false
    if (search && !m.key.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const groupedByProvider = new Map<string, typeof filteredModels>()
  for (const m of filteredModels) {
    const list = groupedByProvider.get(m.providerId) ?? []
    list.push(m)
    groupedByProvider.set(m.providerId, list)
  }

  const selectedCount = values.candidateSelection.length
  const providerCount = new Set(values.candidateSelection.map((k) => k.split('/')[0])).size

  return (
    <Overlay title={props.title} onClose={props.onClose}>
      <div className="space-y-4">
        {error && <div className="text-sm text-destructive">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <LabeledField label="Virtual Model ID" description="Unique identifier used in API requests">
            <Input value={values.id} onChange={(event) => setField('id', event.target.value)} disabled={props.isEdit} />
          </LabeledField>
          <LabeledField label="Display Name" description="Friendly name shown in the UI">
            <Input value={values.name} onChange={(event) => setField('name', event.target.value)} />
          </LabeledField>
        </div>
        <LabeledField label="Strategy">
          <select className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm" value={values.strategy} onChange={(event) => setField('strategy', event.target.value as VmFormValues['strategy'])}>
            <option value="highest_rank_available">Highest Rank Available</option>
            <option value="remaining_limit">Remaining Limit (failover on quota exhausted)</option>
          </select>
        </LabeledField>

        <div>
          <label className="block">
            <span className="text-xs font-mono uppercase text-muted-foreground">Backend Models</span>
          </label>
          <div className="flex items-center gap-2 mt-2">
            <select className="h-8 rounded border border-input bg-transparent px-2 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All types</option>
              {ENDPOINT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            <Input className="h-8 text-sm" placeholder="Search models…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="mt-2 space-y-2 max-h-64 overflow-auto pr-1">
            {Array.from(groupedByProvider.entries()).map(([providerId, models]) => {
              const selectedInGroup = models.filter((m) => values.candidateSelection.includes(m.key)).length
              return (
                <div key={providerId} className="rounded border border-border">
                  <div className="px-3 py-1.5 bg-secondary/50 text-xs font-medium text-muted-foreground">
                    {providerId} ({selectedInGroup}/{models.length} selected)
                  </div>
                  {models.map((m) => {
                    const isSelected = values.candidateSelection.includes(m.key)
                    const inputStr = m.capabilities.input?.join('+') ?? '?'
                    const outputStr = m.capabilities.output?.join('+') ?? '?'
                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => toggleCandidate(m.key)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors border-t border-border/50',
                          isSelected ? 'bg-primary/5' : 'hover:bg-secondary/30'
                        )}
                      >
                        <input type="checkbox" checked={isSelected} readOnly className="shrink-0" />
                        <span className="font-mono flex-1 truncate">{m.modelId}</span>
                        <span className="text-2xs uppercase text-muted-foreground shrink-0">{m.endpointType}</span>
                        <span className="text-2xs text-muted-foreground shrink-0">{inputStr} → {outputStr}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
          {selectedCount > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              {selectedCount} model{selectedCount !== 1 ? 's' : ''} selected across {providerCount} provider{providerCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={props.onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={async () => {
              setSaving(true)
              setError(null)
              try {
                await props.onSubmit(values)
              } catch (err) {
                setError(getErrorMessage(err, 'Failed to save virtual model'))
              } finally {
                setSaving(false)
              }
            }}
            disabled={saving}
          >
            {props.isEdit ? 'Update' : 'Create'} Virtual Model
          </Button>
        </div>
      </div>
    </Overlay>
  )
}

type VmFormValues = {
  id: string
  name: string
  strategy: 'highest_rank_available' | 'remaining_limit'
  candidateSelection: string[]
}

function emptyVmForm(): VmFormValues {
  return {
    id: '',
    name: '',
    strategy: 'highest_rank_available',
    candidateSelection: [],
  }
}

function vmToForm(vm: VirtualModel): VmFormValues {
  return {
    id: vm.id,
    name: vm.name,
    strategy: vm.strategy,
    candidateSelection: vm.candidateSelection ?? [],
  }
}

function parseVmForm(values: VmFormValues) {
  if (!values.id.trim()) {
    throw new Error('Virtual Model ID is required')
  }
  return {
    id: values.id.trim(),
    name: values.name.trim() || values.id.trim(),
    strategy: values.strategy,
    candidateSelection: values.candidateSelection,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Servers Panel
// ─────────────────────────────────────────────────────────────────────────────

function McpServersPanel() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listMcpServers()
      setServers(res.data)
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load MCP servers'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try { await fn(); await load() }
    catch (err) { setError(getErrorMessage(err, 'Operation failed')) }
    finally { setBusy(null) }
  }

  const handleAdd = async () => {
    if (!newName.trim() || !newUrl.trim()) return
    await run('add', async () => {
      await addMcpServer(newName.trim(), newUrl.trim(), true)
      setNewName('')
      setNewUrl('')
      setShowAdd(false)
    })
  }

  const statusDot = (status: McpServer['status']) => cn(
    'w-2 h-2 rounded-full flex-shrink-0',
    status === 'connected' ? 'bg-green-500' : status === 'error' ? 'bg-red-500' : 'bg-muted-foreground'
  )

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plug className="w-3.5 h-3.5 text-primary" />
          <span className="panel-title">MCP Servers</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="h-7 px-2">
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAdd((v) => !v)} className="h-7 px-2 gap-1">
            <Plus className="w-3 h-3" />
            Add
          </Button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-2 rounded bg-destructive/10 border border-destructive/30 text-xs text-destructive">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="p-4 border-b border-border space-y-3">
          <p className="text-xs font-mono uppercase text-muted-foreground">Register new MCP server</p>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Name (e.g. my-tools)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 text-sm font-mono"
            />
            <Input
              placeholder="URL (e.g. http://localhost:3100)"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              className="h-8 text-sm font-mono"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd} disabled={busy === 'add' || !newName.trim() || !newUrl.trim()} className="h-7">
              Register
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); setNewName(''); setNewUrl('') }} className="h-7">
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="divide-y divide-border">
        {loading && servers.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">Loading...</div>
        )}
        {!loading && servers.length === 0 && (
          <div className="p-4 space-y-2">
            <p className="text-sm text-muted-foreground">No MCP servers registered.</p>
            <p className="text-xs text-muted-foreground font-mono">
              Use <code className="bg-input px-1 rounded">waypoi mcp add --name &lt;name&gt; --url &lt;url&gt;</code> or click Add above.
            </p>
          </div>
        )}
        {servers.map((server) => (
          <div key={server.id} className="p-4 flex items-start gap-3">
            <div className={statusDot(server.status)} style={{ marginTop: 4 }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-mono text-sm font-medium truncate">{server.name}</p>
                {server.toolCount !== undefined && server.toolCount > 0 && (
                  <span className="text-2xs font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                    {server.toolCount} tools
                  </span>
                )}
                <span className={cn(
                  'text-2xs font-mono px-1.5 py-0.5 rounded',
                  server.enabled ? 'bg-green-500/10 text-green-400' : 'bg-muted text-muted-foreground'
                )}>
                  {server.enabled ? 'enabled' : 'disabled'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground font-mono truncate">{server.url}</p>
              {server.lastError && (
                <p className="text-xs text-destructive mt-0.5 truncate">{server.lastError}</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost" size="sm"
                className="h-7 px-2 text-xs"
                disabled={busy === `connect:${server.id}`}
                onClick={() => run(`connect:${server.id}`, () => connectMcpServer(server.id).then(() => {}))}
                title="Re-connect and discover tools"
              >
                <RefreshCw className={cn('w-3 h-3', busy === `connect:${server.id}` && 'animate-spin')} />
              </Button>
              <Button
                variant="ghost" size="sm"
                className="h-7 px-2 text-xs"
                disabled={busy === `toggle:${server.id}`}
                onClick={() => run(`toggle:${server.id}`, () =>
                  updateMcpServer(server.id, { enabled: !server.enabled }).then(() => {})
                )}
                title={server.enabled ? 'Disable' : 'Enable'}
              >
                <Power className={cn('w-3 h-3', server.enabled && 'text-green-400')} />
              </Button>
              <Button
                variant="ghost" size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                disabled={busy === `delete:${server.id}`}
                onClick={() => {
                  if (confirm(`Remove MCP server "${server.name}"?`)) {
                    void run(`delete:${server.id}`, () => deleteMcpServer(server.id))
                  }
                }}
                title="Remove"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
