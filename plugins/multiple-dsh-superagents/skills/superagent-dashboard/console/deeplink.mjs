#!/usr/bin/env node
/**
 * 可选补丁：给 dsh-superagent 面板加 URL 深层链接，让看板能直接跳到某个标签。
 *
 *   node deeplink.mjs status [--dir <checkout>]
 *   node deeplink.mjs apply  [--dir <checkout>] [--build]
 *   node deeplink.mjs revert [--dir <checkout>] [--build]
 *
 * 目录解析顺序：--dir → $DSH_SUPERAGENT_DIR → 舰队清单里的 checkout → ~/work/code/dsh-superagent
 * 脚本只做三件事：检测、git apply、可选 pnpm build；不碰别的文件，也不删除任何东西。
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PATCH = resolve(HERE, '..', 'patch', 'panel-deeplink.patch')
const FLEET = process.env.FLEET_FILE || join(homedir(), '.dsh', 'superagent-fleet.json')

const [command = 'status', ...rest] = process.argv.slice(2)
const flag = (name) => rest.includes(`--${name}`)
const value = (name) => {
  const index = rest.indexOf(`--${name}`)
  return index >= 0 ? rest[index + 1] : undefined
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return undefined }
}

async function checkoutDir() {
  const explicit = value('dir') || process.env.DSH_SUPERAGENT_DIR
  if (explicit) return resolve(explicit)
  const fleet = await readJson(FLEET)
  const fromFleet = fleet?.instances?.find((item) => item.checkout)?.checkout
  if (fromFleet) return fromFleet
  return join(homedir(), 'work', 'code', 'dsh-superagent')
}

async function inspect(dir) {
  const route = join(dir, 'src', 'client', 'route.ts')
  const bundle = join(dir, 'lib', 'client.js')
  let applied = false
  let built = false
  try { applied = (await readFile(route, 'utf8')).includes('routeFromUrl') } catch { /* 不是 checkout */ }
  try { built = (await readFile(bundle, 'utf8')).includes('routeFromUrl') } catch { /* 还没构建 */ }
  const dirty = await run('git', ['-C', dir, 'status', '--porcelain']).then((r) => r.code === 0 && r.out.trim().length > 0).catch(() => false)
  return {
    dir,
    exists: existsSync(join(dir, 'package.json')),
    patch: existsSync(PATCH),
    applied,
    built,
    dirty,
  }
}

function run(bin, args, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(bin, args, { stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout?.on('data', (chunk) => (out += chunk))
    child.stderr?.on('data', (chunk) => (out += chunk))
    child.on('close', (code) => resolvePromise({ code, out }))
  })
}

async function build(dir) {
  process.stdout.write('→ pnpm build\n')
  const result = await run('pnpm', ['build'], { capture: false, cwd: dir })
  return result.code === 0
}

function report(state) {
  const line = (label, ok, detail = '') => console.log(`  ${ok ? '✔' : '✘'} ${label}${detail ? '  ' + detail : ''}`)
  console.log(`checkout: ${state.dir}`)
  line('目录存在', state.exists)
  line('补丁已应用（route.ts 含 routeFromUrl）', state.applied)
  line('已重新构建（lib/client.js 含 routeFromUrl）', state.built)
  line('工作区干净', !state.dirty, state.dirty ? '有未提交改动，revert 可能受影响' : '')
}

async function main() {
  const dir = await checkoutDir()
  let state = await inspect(dir)

  if (command === 'status') {
    report(state)
    console.log(state.applied && state.built
      ? '\n结论：已启用深层链接，看板可以直接跳到面板标签。'
      : '\n结论：未启用深层链接；看板仍可用，但“跳转”只会打开面板首页。')
    process.exit(state.exists ? 0 : 1)
  }

  if (!state.exists) {
    console.error(`✘ ${dir} 不像 dsh-superagent 的检出目录（缺 package.json）`)
    process.exit(1)
  }
  if (!state.patch) {
    console.error(`✘ 找不到补丁文件：${PATCH}`)
    process.exit(1)
  }

  if (command === 'apply') {
    if (state.applied) {
      console.log('补丁已经应用过，跳过 git apply。')
    } else {
      const check = await run('git', ['-C', dir, 'apply', '--check', PATCH])
      if (check.code !== 0) {
        console.error('✘ 补丁无法干净应用，通常是上游版本变了。')
        console.error(check.out.trim())
        console.error('\n解决：在目标 checkout 里手工加两处（route.ts 的 routeFromUrl、index.tsx 的 selectPanel），')
        console.error('或用 `git apply --reject` 看被拒绝的片段再合并。')
        process.exit(1)
      }
      const applied = await run('git', ['-C', dir, 'apply', PATCH])
      if (applied.code !== 0) {
        console.error('✘ git apply 失败：')
        console.error(applied.out.trim())
        process.exit(1)
      }
      console.log('✔ 补丁已应用')
      state = await inspect(dir)
    }
    if (flag('build')) { if (!(await build(dir))) process.exit(1) }
    else if (!state.built) console.log('提示：还没重新构建，跳转不会生效——补一句 --build，或手动 pnpm build。')
    console.log('\n下一步：重启正在运行的实例，让浏览器拿到新的 client.js。')
    console.log('  ./scripts/dsh-superagent --profile <p> --url http://127.0.0.1:<port> restart')
    console.log('然后硬刷新已打开的面板页（⌘⇧R）。')
    process.exit(0)
  }

  if (command === 'revert') {
    if (!state.applied) {
      console.log('补丁本来就没应用，无需回退。')
      process.exit(0)
    }
    const reversed = await run('git', ['-C', dir, 'apply', '-R', PATCH])
    if (reversed.code !== 0) {
      console.error('✘ 反向应用失败（文件可能被改过）：')
      console.error(reversed.out.trim())
      console.error(`\n可以手工还原：git -C ${dir} checkout -- src/client/route.ts src/client/index.tsx`)
      process.exit(1)
    }
    console.log('✔ 补丁已回退')
    if (flag('build')) { if (!(await build(dir))) process.exit(1) }
    console.log('\n记得重启实例，并硬刷新面板页。')
    process.exit(0)
  }

  console.error(`未知命令：${command}\n用法：node deeplink.mjs <status|apply|revert> [--dir <checkout>] [--build]`)
  process.exit(2)
}

await main()
