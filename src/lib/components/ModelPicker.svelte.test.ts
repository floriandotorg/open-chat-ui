import { mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import '../../routes/layout.css'
import type { ModelInfo } from '$lib/types'
import ModelPicker from './ModelPicker.svelte'

let instance: Record<string, unknown> | undefined

const info = (id: string, name: string): ModelInfo => ({ id, name, contextWindow: 128000, maxOutputTokens: 16384, capabilities: ['streaming'] })

afterEach(async () => {
  if (instance) await unmount(instance)
  document.body.innerHTML = ''
})

test('dropdown portals to body, escaping nested backdrop-filter contexts', async () => {
  const header = document.createElement('header')
  header.className = 'liquid-glass-bar-top'
  document.body.append(header)

  instance = mount(ModelPicker, {
    target: header,
    props: { models: [info('openai/gpt-4o', 'GPT-4o')], selectedModel: '' },
  }) as Record<string, unknown>

  const trigger = header.querySelector('button')
  if (!trigger) throw new Error('trigger not rendered')
  trigger.click()
  await new Promise(resolve => setTimeout(resolve, 50))

  const dropdown = [...document.body.children].find(el => el.classList.contains('liquid-glass') && el.classList.contains('fixed'))
  if (!dropdown) throw new Error('dropdown not rendered')
  expect(dropdown.parentElement).toBe(document.body)
  expect(getComputedStyle(dropdown).backdropFilter).toContain('blur')
})

test('label shows the selected model name', async () => {
  instance = mount(ModelPicker, {
    target: document.body,
    props: { models: [info('openai/gpt-4o', 'GPT-4o'), info('anthropic/claude-4', 'Claude 4')], selectedModel: 'anthropic/claude-4' },
  }) as Record<string, unknown>

  const trigger = document.querySelector('button[aria-label^="Model:"]')
  if (!trigger) throw new Error('trigger not rendered')
  expect(trigger.textContent).toContain('Claude 4')
})

test('selecting a model fires onmodelchange', async () => {
  const onmodelchange = vi.fn()
  instance = mount(ModelPicker, {
    target: document.body,
    props: { models: [info('openai/gpt-4o', 'GPT-4o')], selectedModel: '', onmodelchange },
  }) as Record<string, unknown>

  const trigger = document.querySelector('button[aria-label^="Model:"]') as HTMLButtonElement
  if (!trigger) throw new Error('trigger not rendered')
  trigger.click()
  await new Promise(resolve => setTimeout(resolve, 50))

  const option = [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes('GPT-4o') && b !== trigger)
  if (!option) throw new Error('option not rendered')
  option.click()
  await new Promise(resolve => setTimeout(resolve, 50))

  expect(onmodelchange).toHaveBeenCalledWith('openai/gpt-4o', 'GPT-4o')
})

test('clears an invalid selection once models are available', async () => {
  const onmodelchange = vi.fn()
  instance = mount(ModelPicker, {
    target: document.body,
    props: { models: [info('openai/gpt-4o', 'GPT-4o')], selectedModel: 'openai/gone', onmodelchange },
  }) as Record<string, unknown>

  await new Promise(resolve => setTimeout(resolve, 50))

  expect(onmodelchange).toHaveBeenCalledWith('', '')
})

test('keeps a valid selection without firing onmodelchange', async () => {
  const onmodelchange = vi.fn()
  instance = mount(ModelPicker, {
    target: document.body,
    props: { models: [info('openai/gpt-4o', 'GPT-4o')], selectedModel: 'openai/gpt-4o', onmodelchange },
  }) as Record<string, unknown>

  await new Promise(resolve => setTimeout(resolve, 50))

  expect(onmodelchange).not.toHaveBeenCalled()
})

test('shows empty state when no models are available', async () => {
  instance = mount(ModelPicker, {
    target: document.body,
    props: { models: [], selectedModel: '' },
  }) as Record<string, unknown>

  const trigger = document.querySelector('button[aria-label^="Model:"]') as HTMLButtonElement
  if (!trigger) throw new Error('trigger not rendered')
  trigger.click()
  await new Promise(resolve => setTimeout(resolve, 50))

  const dropdown = [...document.body.children].find(el => el.classList.contains('liquid-glass'))
  if (!dropdown) throw new Error('dropdown not rendered')
  expect(dropdown.textContent).toContain('No API keys configured')
})
