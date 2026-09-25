import assert from 'node:assert/strict'
import { test } from 'node:test'
import { modelFileRole, modelDownloadParts, modelDownloadState } from '../dist-electron/shared/model-library.js'
const file = name => ({ file: name, size: 100, format: 'GGUF', quantization: 'Q4_K_M' })
const local = name => ({ file: name, repoId: 'repo/model', exists: true })
const task = (name, status) => ({ file: name, repoId: 'repo/model', status })

test('only first shards and main models are startup candidates', () => {
  assert.equal(modelFileRole('sub/mmproj-F16.gguf'), 'projector')
  assert.equal(modelFileRole('model-00002-of-00003.gguf'), 'shard')
  assert.equal(modelFileRole('model-00001-of-00003.gguf'), 'model')
  assert.equal(modelFileRole('model.gguf'), 'model')
})
test('download bundle includes exact shards and the unique same-directory projector', () => {
  const first = file('q/model-00001-of-00002.gguf')
  const second = file('q/model-00002-of-00002.gguf')
  const projector = file('q/mmproj.gguf')
  assert.deepEqual(modelDownloadParts(first, [first, second, projector, file('q/model-other-00001-of-00002.gguf'), file('other/mmproj.gguf')]), [first, second, projector])
  assert.deepEqual(modelDownloadParts(projector, [first, second, projector]), [projector])
  assert.deepEqual(modelDownloadParts(first, [first, second, projector, file('q/mmproj-F16.gguf')]), [first, second])
})
test('already downloaded requires every shard and companion to exist', () => {
  const names = ['model-00001-of-00002.gguf', 'model-00002-of-00002.gguf', 'mmproj.gguf']
  const parts = names.map(file)
  assert.equal(modelDownloadState('repo/model', parts, names.map(local), []), 'local')
  assert.equal(modelDownloadState('repo/model', parts, names.slice(0, 2).map(local), []), 'download')
  assert.equal(modelDownloadState('repo/model', parts.slice(0, 1), [local(names[0])], []), 'download')
  assert.equal(modelDownloadState('different/repo', parts, names.map(local), []), 'download')
  assert.equal(modelDownloadState('repo/model', parts, names.map(name => ({...local(name), exists:false})), names.map(name => task(name, 'completed'))), 'download')
})
test('download action follows current task, ignoring older failed attempts', () => {
  const parts = [file('model.gguf')]
  assert.equal(modelDownloadState('repo/model', parts, [], [task('model.gguf', 'failed'), task('model.gguf', 'downloading')]), 'active')
  assert.equal(modelDownloadState('repo/model', parts, [], [task('model.gguf', 'failed'), task('model.gguf', 'cancelled')]), 'download')
  assert.equal(modelDownloadState('repo/model', parts, [], [task('model.gguf', 'paused')]), 'paused')
  assert.equal(modelDownloadState('repo/model', parts, [], [task('model.gguf', 'failed')]), 'failed')
})
