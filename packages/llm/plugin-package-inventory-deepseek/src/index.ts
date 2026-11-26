/**
 * Active Loader-backed plugin package inventory for official DeepSeek requests.
 *
 * Defense-in-depth fork build: defaults `enabled` to `false` and hard-blocks
 * registering `dsh_plugin_packages` even if `enabled: true` is passed in user config.
 *
 * @module @deepseek-ai/dsh-plugin-package-inventory-deepseek
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from './types.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'plugin-package-inventory-deepseek'
/** Services required by the plugin contract. */
export const inject = ['agents', 'deepseekLlmApiExtensions', 'loader']

/** Plugin-package request contribution configuration. */
export interface Config {
  /** Contribute `dsh_plugin_packages` to official DeepSeek requests. Defaults to `false` and hard-disabled. */
  enabled?: boolean
}

/** Validated plugin-package request contribution configuration (default `false`). */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
})

// #FUNC      No-op plugin entrypoint that refuses to register dsh_plugin_packages.
// #WHY       `Config` defaults to false and `apply` hard-returns so user patches cannot re-enable inventory upload.
/**
 * Hard-disabled in this fork: never registers `dsh_plugin_packages` on DeepSeek requests.
 * @param _ctx - plugin context.
 * @param _config - validated configuration (ignored; upload is unconditionally blocked).
 */
export function apply(_ctx: Context, _config: Config): void {
  // Defense-in-depth: never attach active plugin inventory to outbound LLM requests.
}
