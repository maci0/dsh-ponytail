#!/usr/bin/env node
/**
 * Install dsh-ponytail into every DSH profile on this machine.
 *
 * For each profile directory under `$DSH_HOME/profiles`:
 *
 * 1. add the package as a dependency (`pnpm add <plugin>` in the profile), so
 *    the bare specifier `dsh-ponytail` resolves from that profile; and
 * 2. append the plugin row to the profile's `cordis.patch.yml` unless it is
 *    already there, which is what actually mounts it.
 *
 * The package deliberately does not declare `dsh.bundle`: `dsh plugin add`
 * would then rewrite `dsh.profile.bundles`, and a profile's bundle list is read
 * at boot — a live profile would need a restart, and a profile that also kept
 * the patch row would insert the plugin twice. A plain dependency plus the row
 * applies on the next patch reload and stays idempotent.
 *
 * Usage: node scripts/install.mjs [--dry-run]
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = 'dsh-ponytail'
const ENTRY_ID = 'ponytail'

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshHome = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
const profilesDir = join(dshHome, 'profiles')
const dryRun = process.argv.includes('--dry-run')

/**
 * The patch block every profile needs, byte-identical each run so re-running is
 * a no-op rather than a growing diff.
 * @returns the YAML fragment to ensure.
 */
function patchBlock() {
  return [
    '- insert:',
    `    - id: ${ENTRY_ID}`,
    `      name: '${PACKAGE_NAME}'`,
    '      config:',
    '        defaultMode: full',
    '',
  ].join('\n')
}

/**
 * Add the row to a patch file, or leave an already-equipped file untouched.
 * @param path - the profile's `cordis.patch.yml`.
 * @returns what happened, for the summary.
 */
function ensurePatchRow(path) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (current.includes(`id: ${ENTRY_ID}`) && current.includes(PACKAGE_NAME)) return 'row present'

  // An empty layer is written as `[]`; a block sequence cannot follow it.
  const emptied = current.replace(/\[\]\s*$/, '').trimEnd()
  const next = `${emptied === '' ? '' : `${emptied}\n`}${patchBlock()}`
  if (dryRun) return 'row would be added'

  writeFileSync(path, next)
  return 'row added'
}

/**
 * Ensure the profile depends on this package.
 * @param dir - the profile directory (pnpm's cwd).
 * @param manifest - the parsed profile manifest.
 * @returns what happened, for the summary.
 */
function ensureDependency(dir, manifest) {
  if (manifest.dependencies?.[PACKAGE_NAME] !== undefined) return 'dependency present'
  if (dryRun) return 'dependency would be added'

  const result = spawnSync('pnpm', ['add', pluginDir], { cwd: dir, stdio: 'inherit' })
  if (result.error !== undefined) {
    throw new Error(`pnpm could not run in ${dir}: ${result.error.message}`)
  }
  if (result.status !== 0) throw new Error(`pnpm add failed in ${dir} (exit ${String(result.status)})`)
  return 'dependency added'
}

if (!existsSync(profilesDir)) {
  console.error(`install: no profiles directory at ${profilesDir}`)
  process.exit(1)
}

const profiles = readdirSync(profilesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(profilesDir, name, 'package.json')))

if (profiles.length === 0) {
  console.error(`install: no initialized profiles under ${profilesDir}`)
  process.exit(1)
}

for (const profile of profiles) {
  const dir = join(profilesDir, profile)
  const manifestPath = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const dependency = ensureDependency(dir, manifest)
  const row = ensurePatchRow(join(dir, 'cordis.patch.yml'))
  console.log(`${profile}: ${dependency}; ${row}`)
}

console.log(
  dryRun
    ? '\ninstall: dry run, nothing written'
    : `\ninstall: ${PACKAGE_NAME} is wired into ${profiles.length} profile(s). `
      + 'A profile with "patchReload": "live" picks it up without a restart; the Web client needs a page refresh.',
)
