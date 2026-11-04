#!/usr/bin/env node
/**
 * superagent-fleet-console — 一个本地网页控制台，用来整体查看和管理多台 dsh-superagent。
 *
 * 数据来源：
 *   - ~/.dsh/superagent-fleet.json            实例清单
 *   - http://127.0.0.1:<port>/orchestrator/api 每个实例的只读状态
 *   - <checkout>/scripts/dsh-superagent        启停
 *   - <checkout>/.artifacts/*.log              面板 token
 *
 * 用法：node server.mjs   （默认 http://127.0.0.1:3099）
 */
import { createServer } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT || 3099)
const FLEET_FILE = process.env.FLEET_FILE || join(homedir(), '.dsh', 'superagent-fleet.json')
const DEFAULT_CHECKOUT = join(homedir(), 'work', 'code', 'dsh-superagent')
const PROBE_TIMEOUT = 2500
const ACTION_TIMEOUT = 120_000

/** 控制台指标 → 面板标签的深层链接片段。 */
const PANEL_TABS = {
  overview: '#overview',
  source: '#source',
  triggers: '#trigger?filter=recent',
  evals: '#eval?window=24h',
  executions: '#execution?filter=working',
  person: '#execution?filter=person',
}

/** 一次探测的短缓存，避免面板每 3 秒刷新时把每个实例都打一遍。 */
const cache = new Map()
const CACHE_MS = 1500

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

async function instances() {
  const fleet = await readJson(FLEET_FILE, { instances: [] })
  return (fleet.instances ?? []).map((item) => ({
    profile: item.profile,
    repo: item.repo,
    port: item.port,
    checkout: item.checkout || DEFAULT_CHECKOUT,
    agent: item.agentLogin,
    lark: item.larkWrapper,
  }))
}

async function api(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}/orchestrator/api${path}`, {
    headers: { 'x-orchestrator-request': '1' },
    signal: AbortSignal.timeout(PROBE_TIMEOUT),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/** 面板各标签对应的明细，按需拉取，避免每轮轮询都多打三次请求。 */
async function detailsFor(port, kind) {
  if (kind === 'triggers') {
    const data = await api(port, '/threads?filter=recent&limit=20')
    return (data.items ?? []).map((thread) => ({
      title: thread.title,
      meta: `${thread.source} · ${thread.stage}`,
      url: thread.url ?? null,
      at: thread.lastAt ?? null,
      text: thread.latest?.preview ?? '',
    }))
  }
  if (kind === 'evals') {
    const data = await api(port, '/decisions?window=24h&limit=20')
    return (data.items ?? []).map((decision) => ({
      title: decision.threadTitle || decision.preview || decision.id,
      meta: `${decision.kind}${decision.strength ? ' · ' + decision.strength : ''}`,
      url: null,
      at: decision.at ?? null,
      text: (decision.reason ?? []).map((reason) => reason.code).filter(Boolean).join(', '),
    }))
  }
  if (kind === 'executions') {
    const data = await api(port, '/tickets?state=working&limit=20')
    return (data.items ?? []).map((ticket) => ({
      title: ticket.title,
      meta: `${ticket.state} · ${ticket.stage}`,
      url: (ticket.threads ?? []).map((thread) => thread.url).find(Boolean) ?? null,
      at: ticket.updatedAt ?? null,
      text: (ticket.summary || '').replace(/\s+/g, ' ').slice(0, 220),
    }))
  }
  throw new Error(`unknown details kind: ${kind}`)
}

/** 从最新一份日志里取带 token 的面板地址；token 每次重启都变。 */
async function panelUrl(checkout, profile, port) {
  const dir = join(checkout, '.artifacts')
  let files
  try {
    files = (await readdir(dir)).filter((name) => name.startsWith(`dsh-superagent-${profile}-`) && name.endsWith('.log'))
  } catch {
    return null
  }
  if (files.length === 0) return null
  const stated = await Promise.all(
    files.map(async (name) => ({ name, mtime: (await stat(join(dir, name))).mtimeMs })),
  )
  stated.sort((a, b) => b.mtime - a.mtime)
  for (const entry of stated.slice(0, 3)) {
    const text = await readFile(join(dir, entry.name), 'utf8')
    const match = [...text.matchAll(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[A-Za-z0-9_-]+`, 'g'))].pop()
    if (match) return match[0]
  }
  return null
}

async function snapshot(inst) {
  const key = `snap:${inst.profile}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value

  const base = {
    profile: inst.profile,
    repo: inst.repo,
    port: inst.port,
    agent: inst.agent,
    running: false,
    panel: null,
    error: null,
    health: {},
    setup: null,
    paused: false,
    flow: null,
    executor: null,
    person: 0,
    problems: [],
  }

  let value
  try {
    const [overview, state, sources] = await Promise.all([
      api(inst.port, '/overview'),
      api(inst.port, '/state'),
      api(inst.port, '/sources'),
    ])
    value = {
      ...base,
      running: true,
      panel: await panelUrl(inst.checkout, inst.profile, inst.port),
      health: state.health ?? {},
      setup: state.setup?.problem ?? null,
      paused: Boolean(state.paused),
      flow: overview.flow ?? null,
      executor: overview.executor ?? null,
      person: Array.isArray(overview.person) ? overview.person.length : 0,
      personTickets: (overview.person ?? []).map((ticket) => ({
        id: ticket.id,
        title: ticket.title,
        action: ticket.action ?? '',
        summary: ticket.summary ?? '',
        url: (ticket.threads ?? []).map((thread) => thread.url).find(Boolean) ?? null,
        updatedAt: ticket.updatedAt ?? null,
      })),
      problems: (overview.problems ?? []).map((problem) => ({
        kind: problem.kind,
        detail:
          problem.detail ||
          problem.source?.health?.detail ||
          problem.source?.title?.zh ||
          problem.thread?.title ||
          problem.name ||
          '',
      })),
      sources: (sources ?? []).map((source) => ({ id: source.id, state: source.state, stats: source.stats })),
    }
  } catch (error) {
    value = {
      ...base,
      error: error?.name === 'TimeoutError' ? 'timeout' : String(error?.message ?? error),
      panel: await panelUrl(inst.checkout, inst.profile, inst.port),
    }
  }
  cache.set(key, { at: Date.now(), value })
  return value
}

async function fleetView() {
  const list = await instances()
  const rows = await Promise.all(list.map(snapshot))
  return {
    generatedAt: new Date().toISOString(),
    fleetFile: FLEET_FILE,
    instances: rows,
  }
}

/** 启停走官方脚本，和手动执行完全等价。 */
function runScript(checkout, profile, port, action) {
  return new Promise((resolve) => {
    const child = spawn(join(checkout, 'scripts', 'dsh-superagent'), ['--profile', profile, '--url', `http://127.0.0.1:${port}`, action], {
      cwd: checkout,
    })
    let output = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), ACTION_TIMEOUT)
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('close', (code) => {
      clearTimeout(timer)
      cache.clear()
      resolve({ ok: code === 0, code, output: output.trim().slice(-4000) })
    })
  })
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

const server = createServer(async (req, res) => {
  const host = req.headers.host ?? ''
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    json(res, 403, { error: 'local only' })
    return
  }
  const url = new URL(req.url ?? '/', `http://${host}`)

  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await readFile(join(ROOT, 'public', 'index.html'))
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(html)
      return
    }

    if (url.pathname === '/api/fleet' && req.method === 'GET') {
      json(res, 200, await fleetView())
      return
    }

    const action = /^\/api\/instances\/([^/]+)\/(start|stop|restart)$/.exec(url.pathname)
    if (action && req.method === 'POST') {
      const profile = decodeURIComponent(action[1])
      const inst = (await instances()).find((item) => item.profile === profile)
      if (!inst) {
        json(res, 404, { error: `unknown instance: ${profile}` })
        return
      }
      json(res, 200, { profile, action: action[2], ...(await runScript(inst.checkout, profile, inst.port, action[2])) })
      return
    }

    const details = /^\/api\/instances\/([^/]+)\/details$/.exec(url.pathname)
    if (details && req.method === 'GET') {
      const profile = decodeURIComponent(details[1])
      const inst = (await instances()).find((item) => item.profile === profile)
      if (!inst) {
        json(res, 404, { error: `unknown instance: ${profile}` })
        return
      }
      const kind = url.searchParams.get('kind') || ''
      try {
        json(res, 200, { profile, kind, items: await detailsFor(inst.port, kind) })
      } catch (error) {
        json(res, 502, { error: String(error?.message ?? error) })
      }
      return
    }

    const panel = /^\/panel\/([^/]+)$/.exec(url.pathname)
    if (panel && req.method === 'GET') {
      const profile = decodeURIComponent(panel[1])
      const inst = (await instances()).find((item) => item.profile === profile)
      if (!inst) {
        json(res, 404, { error: `unknown instance: ${profile}` })
        return
      }
      const target = await panelUrl(inst.checkout, profile, inst.port)
      if (!target) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('面板地址还没有出现在日志里；实例可能没启动，或日志已被清理。')
        return
      }
      // 标签片段由 dsh-superagent 客户端的深层链接解析（#execution?filter=person）。
      const hash = PANEL_TABS[url.searchParams.get('tab') ?? ''] ?? ''
      res.writeHead(302, { location: target + hash, 'cache-control': 'no-store' })
      res.end()
      return
    }

    if (url.pathname === '/healthz') {
      json(res, 200, { ok: true })
      return
    }

    json(res, 404, { error: 'not found' })
  } catch (error) {
    json(res, 500, { error: String(error?.message ?? error) })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`superagent 控制台: http://${HOST}:${PORT}/`)
  console.log(`清单: ${FLEET_FILE}`)
})
