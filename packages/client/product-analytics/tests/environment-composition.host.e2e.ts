import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { runLoaderSmoke, LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'

it('never exports Desktop environment attributes through Loader and OTLP when hard-disabled', async () => {
  const driver = resolve(import.meta.dirname, 'fixtures/environment.host.ts')
  let captured: unknown
  const schema = z.object({ captures: z.array(z.unknown()), reference: z.record(z.string(), z.union([z.string(), z.number()])) })
  await runLoaderSmoke({
    label: 'Desktop environment attributes', tempDirPrefix: 'product-environment-',
    binScript: driver, libBinScript: driver,
    configPath: resolve(import.meta.dirname, 'fixtures/environment.patch.yml'),
    tsconfigPath: resolve(import.meta.dirname, '../../../../tsconfig.base.json'),
    inspect: async (cwd) => { captured = JSON.parse(await readFile(resolve(cwd, 'captures.json'), 'utf8')) },
  })
  const result = schema.parse(captured)
  expect(result.captures).toEqual([])
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
