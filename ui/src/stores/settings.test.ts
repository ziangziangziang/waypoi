import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSettings, updateSetting } from './settings'

class LocalStorageMock {
  private readonly store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  clear(): void {
    this.store.clear()
  }
}

const localStorageMock = new LocalStorageMock()
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
})

test.beforeEach(() => {
  localStorageMock.clear()
})

test('persists last playground model in browser settings', () => {
  const updated = updateSetting('lastPlaygroundModel', 'provider/demo-model')

  assert.equal(updated.lastPlaygroundModel, 'provider/demo-model')
  assert.equal(loadSettings().lastPlaygroundModel, 'provider/demo-model')
})

test('loads legacy settings without a remembered playground model', () => {
  localStorage.setItem('waypoi-settings', JSON.stringify({ defaultImageSize: '512x512' }))

  const settings = loadSettings()

  assert.equal(settings.defaultImageSize, '512x512')
  assert.equal(settings.lastPlaygroundModel, undefined)
})
