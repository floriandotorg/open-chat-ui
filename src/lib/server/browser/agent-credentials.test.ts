import { runCredentialTool } from './agent-credentials'
import { createRunner } from './agent-openai'
import { createFakeHost, fakeState, okResult } from './fake-host'
import { createTaskSession } from './task-session'
import { expect, it } from 'vitest'

const setup = () => {
  const fake = createFakeHost(() => okResult(fakeState(), { text: 'Credential field filled.' }))
  const session = createTaskSession({ host: fake.host, sessionId: 's1', initialState: fakeState(), files: [] })
  return { ...fake, session }
}

it('forwards only credential references and field targets to the host', async () => {
  const { calls, session } = setup()
  expect(await runCredentialTool(session, 'credential_fill', { credentialId: 'credential_1', field: 'password', target: { ref: 'ref_3' } })).toBe('Credential field filled.')
  expect(calls).toEqual([{ actions: [{ type: 'credential_fill', credentialId: 'credential_1', field: 'password', target: { ref: 'ref_3' } }] }])
})

it('rejects invalid credential arguments without echoing their contents', async () => {
  const { calls, session } = setup()
  expect(await runCredentialTool(session, 'credential_fill', { field: 'private-password' })).toBe('Invalid credential tool arguments.')
  expect(calls).toEqual([])
  expect(await runCredentialTool(session, 'not_credentials', {})).toBeNull()
})

it('supports credential tools in the OpenAI and ChatGPT shared runner', async () => {
  const { calls, session } = setup()
  const output = await createRunner(session).runFunction({ name: 'credential_list', arguments: JSON.stringify({ query: 'shop' }) })
  expect(output).toBe('Credential field filled.')
  expect(calls[0]?.actions).toEqual([{ type: 'credential_list', query: 'shop' }])
})
