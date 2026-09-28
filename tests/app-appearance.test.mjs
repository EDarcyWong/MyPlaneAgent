import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAppearance, appearanceDefaults, appearanceVariables } from '../dist-electron/shared/app-appearance.js'
import {backgroundPresets,validBackgroundImage} from '../dist-electron/shared/app-background.js'

test('bundled backgrounds accept only known identifiers while keeping local uploads supported', () => {
  for(const preset of backgroundPresets) assert.equal(validBackgroundImage(`builtin:${preset.id}`),true)
  for(const value of ['builtin:../secret','builtin:unknown','https://example.com/image.png','file:///private.png']) assert.equal(validBackgroundImage(value),false)
  assert.equal(validBackgroundImage('data:image/png;base64,AAAA'),true)
})

test('old preferences retain defaults; malformed appearance values cannot become CSS', () => {
  assert.deepEqual(normalizeAppearance(undefined), appearanceDefaults)
  const value = normalizeAppearance({accentColor:'url(https://invalid)',fontFamily:'bad; color:red',fontSize:100,codeFontSize:NaN,codeLineHeight:0,reduceMotion:'true'})
  assert.equal(value.accentColor,'')
  assert.equal(value.fontFamily,'system')
  assert.equal(value.fontSize,18)
  assert.equal(value.codeFontSize,13)
  assert.equal(value.codeLineHeight,1.3)
  assert.equal(value.reduceMotion,false)
})
test('custom colors and typography apply independently and reset to theme inheritance', () => {
  const css=appearanceVariables({accentColor:'#FFFF00',backgroundColor:'#eeeeee',foregroundColor:'#111111',codeFontSize:18,codeLineHeight:2})
  assert.equal(css['--s-accent'],'#ffff00')
  assert.equal(css['--s-on-accent'],'#111111')
  assert.equal(css['--s-bg'],'#eeeeee')
  assert.equal(css['--s-text'],'#111111')
  assert.equal(css['--app-code-font-size'],'18px')
  assert.equal(css['--app-code-line-height'],'2')
  assert.equal(appearanceVariables({accentColor:'#000066'})['--s-on-accent'],'#ffffff')
  assert.equal(appearanceVariables({})['--s-accent'],undefined)
})
