// Generates an SVG of the languages you recently committed in.
// Runs on Node 24+ with no dependencies (uses built-in fetch).
//
// How it works:
//   1. Lists GH_USER's public repositories that were pushed to in the last DAYS days
//   2. For each, lists commits authored by you (login and/or emails) since then
//   3. Fetches each commit's changed files and adds up additions + deletions per language
//   4. Writes a stacked-bar SVG with a legend
//
// Config (environment variables):
//   GH_TOKEN      required  any token; the workflow's built-in GITHUB_TOKEN is enough
//   GH_USER       required  GitHub username whose public repos are analyzed
//   AUTHORS       optional  comma-separated logins/emails, default: GH_USER
//   DAYS          optional  look-back window in days, default 14
//   LIMIT         optional  max languages shown, default 8
//   THRESHOLD     optional  hide languages under this percentage, default 1
//   MAX_COMMITS   optional  max commits analyzed, default 300
//   CATEGORIES    optional  linguist categories to keep, default "programming,markup"
//   IGNORED       optional  comma-separated language names to hide, e.g. "HTML,CSS"
//   SKIPPED_REPOS optional  comma-separated owner/repo to skip
//   OUTPUT        optional  output path, default "recent-languages.svg"
//   TITLE         optional  card title, default "Recently used languages"

import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

// ---------------------------------------------------------------------------
// Language table: [name, color, linguist category]. Colors follow GitHub linguist.
// ---------------------------------------------------------------------------
const L = {
  JavaScript: ["#f1e05a", "programming"], TypeScript: ["#3178c6", "programming"],
  Python: ["#3572A5", "programming"], Java: ["#b07219", "programming"],
  Kotlin: ["#A97BFF", "programming"], C: ["#555555", "programming"],
  "C++": ["#f34b7d", "programming"], "C#": ["#178600", "programming"],
  Go: ["#00ADD8", "programming"], Rust: ["#dea584", "programming"],
  Ruby: ["#701516", "programming"], PHP: ["#4F5D95", "programming"],
  Swift: ["#F05138", "programming"], "Objective-C": ["#438eff", "programming"],
  Dart: ["#00B4AB", "programming"], Scala: ["#c22d40", "programming"],
  Groovy: ["#4298b8", "programming"], Shell: ["#89e051", "programming"],
  PowerShell: ["#012456", "programming"], Batchfile: ["#C1F12E", "programming"],
  Lua: ["#000080", "programming"], Perl: ["#0298c3", "programming"],
  R: ["#198CE7", "programming"], Julia: ["#a270ba", "programming"],
  MATLAB: ["#e16737", "programming"], Haskell: ["#5e5086", "programming"],
  Elixir: ["#6e4a7e", "programming"], Erlang: ["#B83998", "programming"],
  Clojure: ["#db5855", "programming"], OCaml: ["#ef7a08", "programming"],
  "F#": ["#b845fc", "programming"], Elm: ["#60B5CC", "programming"],
  Zig: ["#ec915c", "programming"], Nim: ["#ffc200", "programming"],
  Assembly: ["#6E4C13", "programming"], Solidity: ["#AA6746", "programming"],
  GDScript: ["#355570", "programming"], "Vim Script": ["#199f4b", "programming"],
  Dockerfile: ["#384d54", "programming"], Makefile: ["#427819", "programming"],
  CMake: ["#DA3434", "programming"], HCL: ["#844FBA", "programming"],
  Nix: ["#7e7eff", "programming"], "Jupyter Notebook": ["#DA5B0B", "markup"],
  HTML: ["#e34c26", "markup"], CSS: ["#663399", "markup"],
  SCSS: ["#c6538c", "markup"], Sass: ["#a53b70", "markup"],
  Less: ["#1d365d", "markup"], Vue: ["#41b883", "markup"],
  Svelte: ["#ff3e00", "markup"], Astro: ["#ff5a03", "markup"],
  TeX: ["#3D6117", "markup"], Markdown: ["#083fa1", "prose"],
  SQL: ["#e38c00", "data"], JSON: ["#292929", "data"],
  YAML: ["#cb171e", "data"], TOML: ["#9c4221", "data"],
  XML: ["#0060ac", "data"],
}

const EXT = {
  js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JavaScript",
  ts: "TypeScript", mts: "TypeScript", cts: "TypeScript", tsx: "TypeScript",
  py: "Python", pyi: "Python", java: "Java", kt: "Kotlin", kts: "Kotlin",
  c: "C", h: "C", cpp: "C++", cc: "C++", cxx: "C++", hpp: "C++", hh: "C++", hxx: "C++",
  cs: "C#", go: "Go", rs: "Rust", rb: "Ruby", php: "PHP", swift: "Swift",
  m: "Objective-C", mm: "Objective-C", dart: "Dart", scala: "Scala", sc: "Scala",
  groovy: "Groovy", gradle: "Groovy", sh: "Shell", bash: "Shell", zsh: "Shell",
  ps1: "PowerShell", psm1: "PowerShell", bat: "Batchfile", cmd: "Batchfile",
  lua: "Lua", pl: "Perl", pm: "Perl", r: "R", jl: "Julia", hs: "Haskell",
  ex: "Elixir", exs: "Elixir", erl: "Erlang", clj: "Clojure", cljs: "Clojure",
  ml: "OCaml", mli: "OCaml", fs: "F#", fsx: "F#", elm: "Elm", zig: "Zig",
  nim: "Nim", asm: "Assembly", s: "Assembly", sol: "Solidity", gd: "GDScript",
  vim: "Vim Script", tf: "HCL", hcl: "HCL", nix: "Nix", ipynb: "Jupyter Notebook",
  html: "HTML", htm: "HTML", css: "CSS", scss: "SCSS", sass: "Sass", less: "Less",
  vue: "Vue", svelte: "Svelte", astro: "Astro", tex: "TeX",
  md: "Markdown", mdx: "Markdown", sql: "SQL", json: "JSON",
  yml: "YAML", yaml: "YAML", toml: "TOML", xml: "XML",
}

const FILENAMES = {
  dockerfile: "Dockerfile", containerfile: "Dockerfile", makefile: "Makefile",
  gnumakefile: "Makefile", "cmakelists.txt": "CMake", gemfile: "Ruby", rakefile: "Ruby",
}

// Paths that are generated or vendored and shouldn't count.
const SKIP_PATH = [
  /(^|\/)(node_modules|vendor|dist|build|out|target|\.next|coverage|__pycache__)\//,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/,
  /\.min\.(js|css)$/,
  /\.(map|snap)$/,
]

export function languageOf(path) {
  if (SKIP_PATH.some((re) => re.test(path))) return null
  const base = path.split("/").pop().toLowerCase()
  if (FILENAMES[base]) return FILENAMES[base]
  if (base.startsWith("dockerfile.")) return "Dockerfile"
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return null
  return EXT[base.slice(dot + 1)] ?? null
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------
function client(token) {
  let requests = 0
  async function get(url) {
    const full = url.startsWith("http") ? url : `https://api.github.com${url}`
    for (let attempt = 0; ; attempt++) {
      requests++
      const res = await fetch(full, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      })
      if (res.ok) return { data: await res.json(), link: res.headers.get("link") }
      if ([409, 404, 451].includes(res.status)) return { data: [], link: null } // empty or unavailable repo
      if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < 3) {
        const wait = Number(res.headers.get("retry-after") ?? 5 * (attempt + 1))
        console.warn(`GET ${full} -> ${res.status}, retrying in ${wait}s`)
        await new Promise((r) => setTimeout(r, wait * 1000))
        continue
      }
      throw new Error(`GET ${full} -> ${res.status} ${await res.text()}`)
    }
  }
  async function* paginate(url) {
    let next = url
    while (next) {
      const { data, link } = await get(next)
      yield* data
      next = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null
    }
  }
  return { get, paginate, count: () => requests }
}

export async function collect({ token, user, authors, days, maxCommits, skippedRepos }) {
  const gh = client(token)
  const since = new Date(Date.now() - days * 86400_000)
  if (!authors.length) authors = [user]

  // 1. Your public repos pushed to within the window (sorted by push date, so we can stop early).
  const repos = []
  for await (const repo of gh.paginate(`/users/${encodeURIComponent(user)}/repos?type=owner&sort=pushed&direction=desc&per_page=100`)) {
    if (new Date(repo.pushed_at) < since) break
    if (repo.private || skippedRepos.has(repo.full_name.toLowerCase())) continue
    repos.push(repo.full_name)
  }
  console.log(`Repositories pushed in the last ${days} days: ${repos.length}`)

  // 2. Your commits in those repos (default branch), once per author identity.
  const shas = new Map() // sha -> repo
  for (const repo of repos) {
    for (const author of authors) {
      const url = `/repos/${repo}/commits?author=${encodeURIComponent(author)}&since=${since.toISOString()}&per_page=100`
      for await (const c of gh.paginate(url)) {
        if (c.parents?.length > 1) continue // skip merge commits
        shas.set(c.sha, repo)
      }
    }
  }
  console.log(`Commits found: ${shas.size}${shas.size > maxCommits ? ` (analyzing the ${maxCommits} first)` : ""}`)

  // 3. Changed files per commit -> lines per language.
  const totals = {}
  let analyzed = 0
  for (const [sha, repo] of [...shas].slice(0, maxCommits)) {
    const { data } = await gh.get(`/repos/${repo}/commits/${sha}`)
    for (const f of data.files ?? []) {
      const lang = languageOf(f.filename)
      if (!lang) continue
      totals[lang] = (totals[lang] ?? 0) + (f.additions ?? 0) + (f.deletions ?? 0)
    }
    analyzed++
  }
  console.log(`Commits analyzed: ${analyzed}, API requests used: ${gh.count()}`)
  return { totals, commits: analyzed, repos: new Set([...shas.values()]).size }
}

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c])

export function rank(totals, { categories, ignored, limit, threshold = 0 }) {
  const rows = Object.entries(totals)
    .filter(([name, n]) => n > 0 && categories.has(L[name]?.[1]) && !ignored.has(name.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
  const sum = rows.reduce((s, [, n]) => s + n, 0)
  return rows
    .map(([name, n]) => ({ name, lines: n, pct: (n / sum) * 100, color: L[name][0] }))
    .filter((l) => l.pct >= threshold)
    .slice(0, limit)
}

export function render(langs, { title, days, commits, repos }) {
  const W = 480, pad = 16, barY = 44, barH = 10, rowH = 22, cols = 2
  const rows = Math.ceil(langs.length / cols)
  const legendY = barY + barH + 22
  const H = langs.length ? legendY + (rows - 1) * rowH + 18 : 96
  const subtitle = `last ${days} days · ${commits} commit${commits === 1 ? "" : "s"} in ${repos} repo${repos === 1 ? "" : "s"}`

  let body = ""
  if (!langs.length) {
    body = `<text x="${pad}" y="66" class="muted">No commits found in the last ${days} days</text>`
  } else {
    // Stacked bar, clipped to a rounded rectangle.
    const inner = W - pad * 2
    let x = pad
    const segs = langs.map((l, i) => {
      const w = i === langs.length - 1 ? pad + inner - x : (inner * l.pct) / langs.reduce((s, k) => s + k.pct, 0)
      const seg = `<rect x="${x.toFixed(2)}" y="${barY}" width="${Math.max(w, 0).toFixed(2)}" height="${barH}" fill="${l.color}"/>`
      x += w
      return seg
    }).join("")
    body += `<clipPath id="bar"><rect x="${pad}" y="${barY}" width="${inner}" height="${barH}" rx="5"/></clipPath><g clip-path="url(#bar)">${segs}</g>`

    // Legend in two columns, filled top to bottom.
    const colW = inner / cols
    body += langs.map((l, i) => {
      const cx = pad + Math.floor(i / rows) * colW
      const cy = legendY + (i % rows) * rowH
      return `<g transform="translate(${cx},${cy})"><circle cx="5" cy="-4" r="5" fill="${l.color}"/>` +
        `<text x="16" y="0" class="name">${esc(l.name)}</text>` +
        `<text x="${colW - 12}" y="0" class="muted" text-anchor="end">${l.pct < 0.1 ? "&lt;0.1" : l.pct.toFixed(1)}%</text></g>`
    }).join("")
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
<style>
text{font:400 13px -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;fill:#1f2328}
.title{font-weight:600;font-size:14px}.muted{fill:#59636e;font-size:12px}
@media (prefers-color-scheme:dark){text{fill:#e6edf3}.muted{fill:#9198a1}}
</style>
<text x="${pad}" y="22" class="title">${esc(title)}</text>
<text x="${W - pad}" y="22" class="muted" text-anchor="end">${esc(subtitle)}</text>
${body}
</svg>
`
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
const list = (s) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean)

async function main() {
  const env = process.env
  const token = env.GH_TOKEN
  if (!token) throw new Error("GH_TOKEN is required")
  if (!env.GH_USER) throw new Error("GH_USER is required")
  const days = Number(env.DAYS || 14)
  const { totals, commits, repos } = await collect({
    token,
    user: env.GH_USER,
    authors: list(env.AUTHORS),
    days,
    maxCommits: Number(env.MAX_COMMITS || 300),
    skippedRepos: new Set(list(env.SKIPPED_REPOS).map((r) => r.toLowerCase())),
  })
  console.log("Lines changed per language:", totals)
  const langs = rank(totals, {
    categories: new Set(list(env.CATEGORIES || "programming,markup")),
    ignored: new Set(list(env.IGNORED).map((n) => n.toLowerCase())),
    limit: Number(env.LIMIT || 8),
    threshold: Number(env.THRESHOLD ?? 1),
  })
  const output = env.OUTPUT || "recent-languages.svg"
  writeFileSync(output, render(langs, { title: env.TITLE || "Recently used languages", days, commits, repos }))
  console.log(`Wrote ${output}`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
