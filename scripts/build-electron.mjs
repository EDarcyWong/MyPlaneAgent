import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'dist-electron')
const staging = fs.mkdtempSync(path.join(root, '.electron-build-'))
try {
  // Keep the running application's preload and workers intact if compilation fails.
  const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', path.join(root,'electron/tsconfig.json'), '--outDir', staging, '--noEmitOnError'], { cwd:root, stdio:'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status || 1
  else {
    function publish(directory, relative = '') {
      for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
        const name = path.join(relative, entry.name), source = path.join(directory, entry.name)
        if (entry.isDirectory()) { publish(source, name); continue }
        const target = path.join(output, name), data = fs.readFileSync(source)
        if (fs.existsSync(target) && fs.readFileSync(target).equals(data)) continue
        fs.mkdirSync(path.dirname(target), { recursive:true })
        const temporary = `${target}.${path.basename(staging)}.tmp`
        try { fs.writeFileSync(temporary, data); fs.renameSync(temporary, target) }
        finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
      }
    }
    publish(staging)
  }
} finally {
  // Only this invocation's newly created staging directory is removed.
  fs.rmSync(staging, { recursive:true, force:true })
}
