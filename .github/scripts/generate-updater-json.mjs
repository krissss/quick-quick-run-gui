import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const env = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const exec = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

const tag = env('RELEASE_TAG')
const version = env('RELEASE_VERSION')
const repo = env('REPO')
const notes = process.env.RELEASE_NOTES || `See CHANGELOG.md for ${tag}.`
const assetDir = 'updater-assets'

fs.rmSync(assetDir, { recursive: true, force: true })
fs.mkdirSync(assetDir, { recursive: true })

execFileSync(
  'gh',
  ['release', 'download', tag, '--repo', repo, '--pattern', '*.sig', '--dir', assetDir],
  { stdio: 'inherit' },
)

const release = JSON.parse(
  exec('gh', ['release', 'view', tag, '--repo', repo, '--json', 'assets,publishedAt']),
)
const assets = release.assets || []

const findAsset = (label, pattern) => {
  const matches = assets
    .filter((asset) => !asset.name.endsWith('.sig') && pattern.test(asset.name))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (matches.length === 0) {
    throw new Error(`Missing ${label} release asset`)
  }

  return matches[0]
}

const entryFor = (asset) => {
  const sigPath = `${assetDir}/${asset.name}.sig`
  if (!fs.existsSync(sigPath)) {
    throw new Error(`Missing signature asset for ${asset.name}`)
  }

  return {
    signature: fs.readFileSync(sigPath, 'utf8').trim(),
    url: asset.url,
  }
}

const macArm = entryFor(findAsset('macOS arm64 app', /(?:^|_)aarch64\.app\.tar\.gz$/))
const macX64 = entryFor(findAsset('macOS x64 app', /(?:^|_)x64\.app\.tar\.gz$/))
const linux = entryFor(findAsset('Linux AppImage', /_amd64\.AppImage$/))
const windows = entryFor(findAsset('Windows NSIS installer', /_x64-setup\.exe$/))

const latest = {
  version,
  notes,
  pub_date: release.publishedAt || new Date().toISOString(),
  platforms: {
    'darwin-aarch64': macArm,
    'darwin-aarch64-app': macArm,
    'darwin-x86_64': macX64,
    'darwin-x86_64-app': macX64,
    'linux-x86_64': linux,
    'linux-x86_64-appimage': linux,
    'windows-x86_64': windows,
    'windows-x86_64-nsis': windows,
  },
}

fs.writeFileSync('latest.json', `${JSON.stringify(latest, null, 2)}\n`)
