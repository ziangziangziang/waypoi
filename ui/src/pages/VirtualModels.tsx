import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { ArrowDown, ArrowUp, Layers, Pencil, Plus, Power, RefreshCw, Search, Trash2, X } from 'lucide-react'
import {
  createVirtualModel,
  deleteVirtualModel,
  listProviders,
  listVirtualModelEvents,
  listVirtualModels,
  toggleVirtualModel,
  updateVirtualModel,
  type EndpointType,
  type Provider,
  type ProviderModel,
  type VirtualModel,
  type VirtualModelSwitchEvent,
} from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const ENDPOINT_OPTIONS: EndpointType[] = ['llm', 'diffusion', 'audio', 'embedding']

type BackendModel = {
  key: string
  providerId: string
  providerName: string
  model: ProviderModel
}

type VmFormValues = {
  id: string
  name: string
  strategy: 'highest_rank_available' | 'remaining_limit'
  candidateSelection: string[]
  freeOnly: boolean
  endpointType: 'all' | EndpointType
  search: string
}

export function VirtualModels() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [virtualModels, setVirtualModels] = useState<VirtualModel[]>([])
  const [eventsByModel, setEventsByModel] = useState<Record<string, VirtualModelSwitchEvent[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; initial?: VirtualModel } | null>(null)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [providerData, vmData] = await Promise.all([listProviders(), listVirtualModels()])
      setProviders(providerData)
      setVirtualModels(vmData)
      const eventPairs = await Promise.all(
        vmData.map(async (vm) => {
          const events = await listVirtualModelEvents(vm.id).catch(() => ({ object: 'list' as const, data: [] }))
          return [vm.id, events.data] as const
        })
      )
      setEventsByModel(Object.fromEntries(eventPairs))
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load virtual models'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const backendModels = useMemo(
    () =>
      providers.flatMap((provider) =>
        provider.models.map((model) => ({
          key: `${provider.id}/${model.modelId}`,
          providerId: provider.id,
          providerName: provider.name,
          model,
        }))
      ),
    [providers]
  )

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusyKey(key)
    setError(null)
    try {
      await fn()
      await loadData()
    } catch (err) {
      setError(getErrorMessage(err, 'Virtual model update failed'))
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      <header className="sticky top-0 z-20 h-14 border-b border-border bg-background/95 backdrop-blur flex items-center px-6 gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <h2 className="font-mono font-semibold text-sm uppercase tracking-wider">Virtual Models</h2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw className={cn('w-3.5 h-3.5 mr-1', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setForm({ mode: 'create' })}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            Create
          </Button>
        </div>
      </header>

      <div className="flex-1 min-h-0 p-6 overflow-auto">
        <div className="max-w-6xl space-y-4">
          {error && <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          {loading && <div className="text-sm text-muted-foreground">Loading virtual models...</div>}
          {!loading && virtualModels.length === 0 && (
            <div className="panel p-8 text-center text-sm text-muted-foreground">No virtual models configured.</div>
          )}
          {virtualModels.map((vm) => {
            const events = eventsByModel[vm.id] ?? []
            const active = vm.candidates[0]
            const totalLimits = summarizeLimits(active)
            return (
              <div key={vm.id} className="panel overflow-hidden">
                <div className="px-4 py-3 flex items-start gap-3 border-b border-border">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className={cn('status-dot', vm.enabled ? 'status-dot-live' : 'status-dot-down')} />
                      <h3 className="font-medium text-sm">{vm.name}</h3>
                      <span className="text-2xs uppercase text-muted-foreground font-mono">{vm.id}</span>
                      {!vm.userDefined && <span className="text-2xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">built-in</span>}
                    </div>
                    <p className="text-2xs text-muted-foreground mt-1">
                      {vm.candidates.length} backends · {vm.strategy.replace(/_/g, ' ')} · {events.length} switches in 7d
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyKey === `toggle:${vm.id}`}
                      onClick={() => void run(`toggle:${vm.id}`, async () => { await toggleVirtualModel(vm.id) })}
                    >
                      <Power className="w-3.5 h-3.5 mr-1" />
                      {vm.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setForm({ mode: 'edit', initial: vm })} disabled={!vm.userDefined}>
                      <Pencil className="w-3.5 h-3.5 mr-1" />
                      Edit
                    </Button>
                    {vm.userDefined && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        disabled={busyKey === `delete:${vm.id}`}
                        onClick={() => {
                          if (!window.confirm(`Delete virtual model ${vm.id}?`)) return
                          void run(`delete:${vm.id}`, async () => { await deleteVirtualModel(vm.id) })
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/40 text-muted-foreground">
                      <tr>
                        <th className="text-left font-medium px-4 py-2">Rank</th>
                        <th className="text-left font-medium px-4 py-2">Backend</th>
                        <th className="text-left font-medium px-4 py-2">Score</th>
                        <th className="text-left font-medium px-4 py-2">Free</th>
                        <th className="text-left font-medium px-4 py-2">Limits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vm.candidates.map((candidate, index) => (
                        <tr key={candidate.id} className="border-t border-border/50">
                          <td className="px-4 py-2 font-mono">{index + 1}{candidate.id === active?.id ? ' active' : ''}</td>
                          <td className="px-4 py-2 font-mono">{candidate.providerId}/{candidate.modelId}</td>
                          <td className="px-4 py-2">{candidate.score.toFixed(1)} <span className="text-muted-foreground">({candidate.scoreSource})</span></td>
                          <td className="px-4 py-2">{candidate.free ? 'yes' : 'no'}</td>
                          <td className="px-4 py-2 text-muted-foreground">{index === 0 ? totalLimits : summarizeLimits(candidate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {form && (
        <VirtualModelDialog
          title={form.mode === 'create' ? 'Create Virtual Model' : `Edit ${form.initial?.id}`}
          initialValues={form.mode === 'create' ? emptyVmForm() : vmToForm(form.initial!)}
          backendModels={backendModels}
          isEdit={form.mode === 'edit'}
          onClose={() => setForm(null)}
          onSubmit={async (values) => {
            const payload = parseVmForm(values)
            if (form.mode === 'create') await createVirtualModel(payload)
            else await updateVirtualModel(form.initial!.id, payload)
            setForm(null)
            await loadData()
          }}
        />
      )}
    </div>
  )
}

function VirtualModelDialog(props: {
  title: string
  initialValues: VmFormValues
  backendModels: BackendModel[]
  isEdit: boolean
  onClose: () => void
  onSubmit: (values: VmFormValues) => Promise<void>
}) {
  const [values, setValues] = useState(props.initialValues)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const setField = <K extends keyof VmFormValues>(key: K, value: VmFormValues[K]) => setValues((current) => ({ ...current, [key]: value }))
  const selected = new Set(values.candidateSelection)
  const filtered = props.backendModels.filter((entry) => {
    if (values.freeOnly && !entry.model.free) return false
    if (values.endpointType !== 'all' && entry.model.endpointType !== values.endpointType) return false
    const query = values.search.trim().toLowerCase()
    if (query && !entry.key.toLowerCase().includes(query)) return false
    return true
  })

  const toggleCandidate = (key: string) => {
    const next = values.candidateSelection.includes(key)
      ? values.candidateSelection.filter((item) => item !== key)
      : [...values.candidateSelection, key]
    setField('candidateSelection', next)
  }

  const move = (key: string, delta: -1 | 1) => {
    const next = [...values.candidateSelection]
    const index = next.indexOf(key)
    const target = index + delta
    if (index < 0 || target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setField('candidateSelection', next)
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-lg border border-border bg-background shadow-xl flex flex-col">
        <div className="h-12 border-b border-border flex items-center px-4 gap-2 shrink-0">
          <Layers className="w-4 h-4 text-primary" />
          <h3 className="font-mono font-semibold text-sm uppercase tracking-wider">{props.title}</h3>
          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={props.onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-auto space-y-4">
          {error && <div className="text-sm text-destructive">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Virtual Model ID">
              <Input value={values.id} onChange={(event) => setField('id', event.target.value)} disabled={props.isEdit} />
            </Labeled>
            <Labeled label="Display Name">
              <Input value={values.name} onChange={(event) => setField('name', event.target.value)} />
            </Labeled>
          </div>
          <Labeled label="Strategy">
            <select className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm" value={values.strategy} onChange={(event) => setField('strategy', event.target.value as VmFormValues['strategy'])}>
              <option value="highest_rank_available">Highest Rank Available</option>
              <option value="remaining_limit">Remaining Limit</option>
            </select>
          </Labeled>
          <div className="flex items-center gap-2">
            <select className="h-8 rounded border border-input bg-transparent px-2 text-xs" value={values.endpointType} onChange={(event) => setField('endpointType', event.target.value as VmFormValues['endpointType'])}>
              <option value="all">All types</option>
              {ENDPOINT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={values.freeOnly} onChange={(event) => setField('freeOnly', event.target.checked)} />
              Free only
            </label>
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="pl-7 h-8 text-sm" placeholder="Search backends..." value={values.search} onChange={(event) => setField('search', event.target.value)} />
            </div>
          </div>
          <div className="max-h-80 overflow-auto rounded border border-border">
            {filtered.map((entry) => {
              const isSelected = selected.has(entry.key)
              const rank = values.candidateSelection.indexOf(entry.key)
              return (
                <div key={entry.key} className={cn('flex items-center gap-2 px-3 py-2 border-b border-border/50 text-xs last:border-0', isSelected && 'bg-primary/5')}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggleCandidate(entry.key)} />
                  <span className="font-mono flex-1 truncate">{entry.key}</span>
                  <span className="text-muted-foreground">{entry.model.endpointType}</span>
                  {entry.model.free && <span className="text-primary">free</span>}
                  {typeof entry.model.benchmark?.livebench === 'number' && <span>LiveBench {entry.model.benchmark.livebench.toFixed(1)}</span>}
                  {isSelected && (
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-muted-foreground">#{rank + 1}</span>
                      <button onClick={() => move(entry.key, -1)} disabled={rank <= 0} className="p-1 disabled:opacity-40"><ArrowUp className="w-3 h-3" /></button>
                      <button onClick={() => move(entry.key, 1)} disabled={rank < 0 || rank >= values.candidateSelection.length - 1} className="p-1 disabled:opacity-40"><ArrowDown className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={props.onClose} disabled={saving}>Cancel</Button>
            <Button
              disabled={saving}
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
            >
              {props.isEdit ? 'Update' : 'Create'} Virtual Model
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Labeled(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-mono uppercase text-muted-foreground mb-1">{props.label}</span>
      {props.children}
    </label>
  )
}

function emptyVmForm(): VmFormValues {
  return { id: '', name: '', strategy: 'highest_rank_available', candidateSelection: [], freeOnly: true, endpointType: 'llm', search: '' }
}

function vmToForm(vm: VirtualModel): VmFormValues {
  return { id: vm.id, name: vm.name, strategy: vm.strategy, candidateSelection: vm.candidateSelection ?? [], freeOnly: true, endpointType: 'all', search: '' }
}

function parseVmForm(values: VmFormValues) {
  if (!values.id.trim()) throw new Error('Virtual model ID is required')
  if (values.candidateSelection.length === 0) throw new Error('Select at least one backend model')
  return {
    id: values.id.trim(),
    name: values.name.trim() || values.id.trim(),
    aliases: [values.id.trim()],
    strategy: values.strategy,
    candidateSelection: values.candidateSelection,
  }
}

function summarizeLimits(candidate: VirtualModel['candidates'][number] | undefined): string {
  if (!candidate?.limits) return 'none'
  const parts = [
    formatLimit('rpm', candidate.limits.requestsPerMinute),
    formatLimit('rpd', candidate.limits.requestsPerDay),
    formatLimit('tpm', candidate.limits.tokensPerMinute),
    formatLimit('tpd', candidate.limits.tokensPerDay),
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : 'none'
}

function formatLimit(label: string, value?: number): string | null {
  return typeof value === 'number' ? `${value.toLocaleString()} ${label}` : null
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}
