import { mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import '../../routes/layout.css'
import ModelPicker from './ModelPicker.svelte'

let instance: Record<string, unknown> | undefined

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
    props: { providers: [], selectedModel: null },
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
