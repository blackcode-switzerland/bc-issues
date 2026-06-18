#!/usr/bin/env node
const https = require('https')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const VERSION = require('./package.json').version
const REPO = 'blackcode-switzerland/bc-issues'
const BIN_DIR = path.join(__dirname, 'bin')

const PLATFORM_MAP = {
  'darwin-x64':   `bk-v${VERSION}-darwin-amd64`,
  'darwin-arm64': `bk-v${VERSION}-darwin-arm64`,
  'linux-x64':    `bk-v${VERSION}-linux-amd64`,
  'linux-arm64':  `bk-v${VERSION}-linux-arm64`,
  'win32-x64':    `bk-v${VERSION}-windows-amd64.exe`,
  'win32-arm64':  `bk-v${VERSION}-windows-arm64.exe`,
}

const key = `${process.platform}-${process.arch}`
const asset = PLATFORM_MAP[key]

if (!asset) {
  console.error(`Unsupported platform: ${key}`)
  process.exit(1)
}

const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${asset}`
const isWindows = process.platform === 'win32'
const binPath = path.join(BIN_DIR, isWindows ? 'bk.exe' : 'bk')

if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true })

console.log(`Downloading bk v${VERSION} for ${key}...`)

function download(url, dest, redirects = 0) {
  if (redirects > 5) throw new Error('Too many redirects')
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'npm-install' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(download(res.headers.location, dest, redirects + 1))
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const file = fs.createWriteStream(dest)
      res.pipe(file)
      file.on('finish', () => file.close(resolve))
      file.on('error', reject)
    }).on('error', reject)
  })
}

download(url, binPath)
  .then(() => {
    if (!isWindows) fs.chmodSync(binPath, 0o755)
    console.log(`bk installed to ${binPath}`)
  })
  .catch((err) => {
    console.error(`Failed to download bk: ${err.message}`)
    process.exit(1)
  })
