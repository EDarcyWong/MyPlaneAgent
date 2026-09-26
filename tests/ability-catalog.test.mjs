import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AbilityCatalogService, abilityDefinitions } from '../dist-electron/main/ability-modules/catalog.js'
import { AbilityModuleManager } from '../dist-electron/main/ability-modules/manager.js'
import { policyContracts } from '../dist-electron/main/ability-modules/policies.js'
import { routerContract } from '../dist-electron/main/ability-modules/routing.js'
import { selectionContract } from '../dist-electron/main/ability-modules/selection.js'
import { abilityStages } from '../dist-electron/shared/ability-catalog.js'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myplane-catalog-'))
  const manager = new AbilityModuleManager(path.join(root, 'conversation-state'))
  const selection = new AbilityModuleManager(path.join(root, 'state-context-selection'), undefined, selectionContract)
  const router = new AbilityModuleManager(path.join(root, 'task-message-router'), undefined, routerContract)
  const policyManagers = new Map(policyContracts.map(contract=>[contract.id,new AbilityModuleManager(path.join(root,contract.id),undefined,contract)]))
  const catalog = new AbilityCatalogService(new Map([['conversation-state', manager], ['state-context-selection', selection], ['task-message-router', router], ...policyManagers]))
  t.after(() => { for(const item of policyManagers.values())item.dispose(); router.dispose(); selection.dispose(); manager.dispose(); assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }) })
  return { root, manager, catalog, selection, router, policyManagers }
}

test('reinstall and upgrade preserve catalog archives, full sources and managed module data', async t => {
  const { root, manager, selection, router, policyManagers } = fixture(t)
  manager.setPolicy({ ...manager.snapshot().policy, autoOptimize: false, autoPromote: false })
  const version = manager.saveVersion('bundled-v1', manager.version('bundled-v1').code + '\n// persisted version', '保留版本')
  await manager.activate(version.id)
  manager.rate(version.id, 5, '保留评分')
  manager.reportProblem('保留问题', ['你好'], 'question')
  const before = manager.snapshot()
  manager.dispose()
  const install = path.join(root, 'install')
  fs.mkdirSync(path.join(install, 'ability-modules'), { recursive: true })
  const source = '// previous application\n' + ' '.repeat(45000)
  fs.writeFileSync(path.join(install, 'ability-modules', 'conversation.js'), source)
  const first = new AbilityCatalogService(new Map([['conversation-state', manager], ['state-context-selection', selection], ['task-message-router', router], ...policyManagers]), install, root).list().storage
  const snapshotPath = path.join(root, 'catalog', 'snapshots', first.snapshotId + '.json')
  const originalSnapshot = fs.readFileSync(snapshotPath, 'utf8')
  const manifest = JSON.parse(originalSnapshot)
  assert.equal(manifest.stages.length, 6)
  assert.equal(manifest.modules.length, 18)
  const archivedSource = path.join(root, 'catalog', 'sources', manifest.sources['ability-modules/conversation.js'] + '.json')
  assert.equal(JSON.parse(fs.readFileSync(archivedSource, 'utf8')).code, source, 'archive full source, not UI preview')
  const same = new AbilityCatalogService(new Map(), install, root)
  assert.ok(same)
  assert.equal(fs.readdirSync(path.join(root, 'catalog', 'snapshots')).length, 1, 'restart deduplicates archives')
  assert.ok(path.resolve(install).startsWith(path.resolve(root) + path.sep))
  fs.rmSync(install, { recursive: true })
  assert.equal(fs.readFileSync(snapshotPath, 'utf8'), originalSnapshot, 'uninstall cannot remove external archive')
  fs.mkdirSync(path.join(install, 'ability-modules'), { recursive: true })
  fs.writeFileSync(path.join(install, 'ability-modules', 'conversation.js'), '// upgraded application')
  const restored = new AbilityModuleManager(path.join(root, 'conversation-state'))
  t.after(() => restored.dispose())
  const upgraded = new AbilityCatalogService(new Map([['conversation-state', restored], ['state-context-selection', selection], ['task-message-router', router], ...policyManagers]), install, root).list()
  assert.notEqual(upgraded.storage.snapshotId, first.snapshotId)
  assert.equal(fs.readdirSync(path.join(root, 'catalog', 'snapshots')).length, 2)
  assert.equal(fs.readFileSync(snapshotPath, 'utf8'), originalSnapshot)
  assert.equal(JSON.parse(fs.readFileSync(archivedSource, 'utf8')).code, source)
  assert.deepEqual(restored.snapshot(), before, 'active version, code metadata, policy, ratings, reports, feedback and switches survive')
  assert.equal(restored.version(version.id).code, version.code)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'catalog', 'current.json'), 'utf8')).snapshotId, upgraded.storage.snapshotId)
})

test('Windows installer retains the stable user data directory', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false)
  const entry = fs.readFileSync(new URL('../electron/main/index.ts', import.meta.url), 'utf8')
  assert.match(entry, /path\.join\(app\.getPath\('appData'\),'myplane-agent'\)/)
  assert.match(entry, /MYPLANE_AGENT_DATA_DIR/)
})

test('catalog classifies real implementations under all six stages and has resolvable acyclic dependencies', t => {
  const { catalog } = fixture(t), result = catalog.list()
  assert.deepEqual(result.stages.map(stage => stage.name), ['对话状态管理','消息理解与路由','分步执行与工具筛选','验证与错误恢复','长对话与模型适配','全链路评测与加固'])
  assert.equal(result.modules.length, 18)
  assert.equal(new Set(result.modules.map(module => module.id)).size, result.modules.length)
  for (const stage of abilityStages) assert.ok(result.modules.some(module => module.stageId === stage.id))
  const walk = (id, ancestors = []) => {
    assert.ok(!ancestors.includes(id), `dependency cycle ${ancestors} -> ${id}`)
    const module = result.modules.find(module => module.id === id)
    assert.ok(module, `unknown dependency ${id}`)
    for (const dependency of module.dependencies) walk(dependency, [...ancestors, id])
  }
  for (const module of result.modules) {
    walk(module.id)
    assert.ok(module.inputs.length && module.outputs.length && module.integrationNote)
    if (module.mode === 'planned') assert.equal(module.implementation.length, 0)
    else {
      const detail = catalog.details(module.id)
      assert.deepEqual(detail.missingSources, [], `missing implementation for ${module.id}`)
      assert.ok(detail.sources.length)
      assert.ok(detail.sources.every(source => source.code && /^[0-9a-f]{64}$/.test(source.hash)))
    }
  }
})

test('only explicitly registered managed modules can mutate; unknown IDs never fall back to conversation state', t => {
  const { catalog, manager, root } = fixture(t)
  const index = fs.readFileSync(path.join(root,'conversation-state','index.json'),'utf8')
  assert.equal(catalog.managed(), manager, 'legacy unscoped callers keep the existing store')
  assert.equal(catalog.managed('conversation-state'), manager)
  for (const module of abilityDefinitions.filter(module => module.mode !== 'managed')) assert.throws(() => catalog.managed(module.id), /共用实现|尚未接入/)
  for (const id of ['unknown', '../conversation-state', 'state', null, 42, '']) {
    assert.throws(() => catalog.managed(id), /不存在/)
    assert.throws(() => catalog.details(id), /不存在/)
  }
  assert.equal(fs.readFileSync(path.join(root,'conversation-state','index.json'),'utf8'), index)
  assert.equal(manager.snapshot().versions.length, 1)
})

test('independent intent versions no longer follow extractor publication', async t => {
  const { catalog, manager, policyManagers } = fixture(t)
  const baseline = manager.version('bundled-v1')
  const version = manager.saveVersion(baseline.id, baseline.code + '\n// extractor updated', '独立意图版本检查')
  await manager.activate(version.id)
  const detail = catalog.details('message-intent')
  assert.equal(detail.module.mode, 'managed')
  assert.equal(detail.module.ownerModuleId, undefined)
  assert.equal(detail.module.activeVersion, 'bundled-v1')
  assert.equal(policyManagers.get('message-intent').snapshot().versions.length, 1)
  assert.equal(catalog.list().modules.find(module=>module.id==='conversation-state').versionCount, 2)
})

test('read-only details distinguish missing code from available managed modules', t => {
  const { root, manager, selection, router, policyManagers } = fixture(t)
  const catalog = new AbilityCatalogService(new Map([['conversation-state', manager], ['state-context-selection', selection], ['task-message-router', router], ...policyManagers]), path.join(root, 'missing-app-code'))
  const detail = catalog.details('completion-review')
  assert.ok(detail.missingSources.length)
  assert.equal(detail.implementationVersion, undefined)
  const routing = catalog.details('task-message-router')
  assert.equal(routing.module.mode, 'managed')
  assert.equal(routing.module.activeVersion, 'bundled-v1')
  const listed = catalog.list(); listed.modules[0].name = 'mutated UI'; listed.modules[0].dependencies.push('bad')
  assert.equal(catalog.list().modules[0].name, '目标与约束提取')
  assert.deepEqual(catalog.list().modules[0].dependencies, [])
})
