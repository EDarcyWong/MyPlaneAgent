import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('web Skill supports configured fake-IP proxies while denying private targets and uses a fallback search source', () => {
  const result=spawnSync('python3',['-c',String.raw`
import sys, socket
from unittest.mock import patch
sys.path.insert(0, 'skills/agent-tools')
import index as skill

def lookup(address):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (address, 443))]
with patch.object(skill.socket, 'getaddrinfo', return_value=lookup('198.18.0.20')):
    assert skill.safe_public_url('https://example.com', True)[2] == 'example.com'
    for url, proxy in [('https://example.com', False), ('https://198.18.0.20', True), ('https://localhost', True)]:
        try: skill.safe_public_url(url, proxy)
        except ValueError: pass
        else: raise AssertionError('Unsafe address accepted: '+url)
with patch.object(skill.socket, 'getaddrinfo', return_value=lookup('127.0.0.1')):
    try: skill.safe_public_url('https://example.com', True)
    except ValueError: pass
    else: raise AssertionError('Proxy bypassed private address check')
responses = [{'text':'<html>Search unavailable</html>'}, {'text':'<rss><channel><item><title>Weather</title><link>https://example.com/weather</link><description>Rain</description></item></channel></rss>'}]
with patch.object(skill, 'web_fetch', side_effect=responses), patch.object(skill.socket, 'getaddrinfo', return_value=lookup('1.1.1.1')):
    result=skill.web_search({'query':'weather'})
    assert result['provider']=='Bing'
    assert result['results'][0]['url']=='https://example.com/weather'
    assert result['results'][0]['snippet']=='Rain'
`],{encoding:'utf8'})
  assert.equal(result.status,0,result.stderr)
})
