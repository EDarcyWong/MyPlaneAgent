import test from 'node:test'
import assert from 'node:assert/strict'
import {chatImages,chatMessageContent,maxChatImageBytes} from '../dist-electron/shared/local-ai-chat.js'

const image={name:'sample.png',dataUrl:'data:image/png;base64,aGVsbG8='}
test('text-only history stays compatible and image-only messages reach the model',()=>{
 assert.equal(chatMessageContent({role:'user',content:'hello'}),'hello')
 assert.deepEqual(chatMessageContent({role:'user',content:'',images:[image]}),[{type:'image_url',image_url:{url:image.dataUrl}}])
 assert.deepEqual(chatMessageContent({role:'user',content:'describe',images:[image]}),[{type:'text',text:'describe'},{type:'image_url',image_url:{url:image.dataUrl}}])
})
test('image payloads reject remote URLs, SVG, malformed data, excessive count and size',()=>{
 assert.deepEqual(chatImages(undefined),[])
 assert.deepEqual(chatImages([image]),[image])
 for(const value of [null,{},Array(5).fill(image),[{dataUrl:'https://example.com/image.png'}],[{dataUrl:'data:image/svg+xml;base64,PHN2Zz4='}],[{dataUrl:'data:image/png;base64,abc'}],[{dataUrl:'data:image/png;base64,'}]])assert.throws(()=>chatImages(value))
 const large={name:'large.png',dataUrl:'data:image/png;base64,'+Buffer.alloc(maxChatImageBytes).toString('base64')}
 assert.equal(chatImages([large]).length,1)
 assert.throws(()=>chatImages([large,image]),/总大小/)
})
