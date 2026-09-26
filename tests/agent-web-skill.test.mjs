import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('web Skill supports configured fake-IP proxies while denying private targets and uses a fallback search source', () => {
  const python = [process.env.PYTHON, ...(process.platform === 'win32' ? ['python','python3'] : ['python3','python'])].filter(Boolean)
    .find(command => spawnSync(command,['-c','import sys;sys.exit(0 if sys.version_info.major == 3 else 1)'],{timeout:5000}).status === 0)
  assert.ok(python,'A working Python 3 interpreter is required')
  const result=spawnSync(python,['-c',String.raw`
import sys, socket
from unittest.mock import patch, MagicMock
sys.path.insert(0, 'skills/agent-tools')
import index as skill

url = 'https://www.baidu.com/s?wd=北京市+明天+天气预报'
encoded = skill.encoded_public_url(url)
assert encoded == 'https://www.baidu.com/s?wd=%E5%8C%97%E4%BA%AC%E5%B8%82+%E6%98%8E%E5%A4%A9+%E5%A4%A9%E6%B0%94%E9%A2%84%E6%8A%A5'
assert skill.encoded_public_url(encoded) == encoded
assert skill.encoded_public_url('https://例子.测试/天气 预报?q=a%2Bb#片段') == 'https://xn--fsqu00a.xn--0zwm56d/%E5%A4%A9%E6%B0%94%20%E9%A2%84%E6%8A%A5?q=a%2Bb'
for unsafe in ['https://user:pass@example.com/', 'https://example.com/\r\nHeader: injected']:
    try: skill.encoded_public_url(unsafe)
    except ValueError: pass
    else: raise AssertionError('Invalid URL accepted')

parser = skill.WebPageText()
parser.feed('<html><style>' + 'noise' * 10000 + '</style><nav>Navigation</nav><main><h1>26日（今天）</h1><p>阴转中雨</p><p>31/24℃</p></main></html>')
assert '26日（今天）' in parser.text()
assert '阴转中雨' in parser.text()
assert '31/24℃' in parser.text()
assert 'noise' not in parser.text()
assert 'Navigation' not in parser.text()

def lookup(address):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (address, 443))]
with patch.object(skill.socket, 'getaddrinfo', return_value=lookup('1.1.1.1')), patch.object(skill.urllib.request, 'getproxies', return_value={}), patch.object(skill.socket, 'create_connection'), patch.object(skill.ssl, 'create_default_context'), patch.object(skill.http.client, 'HTTPSConnection') as connection:
    redirected = MagicMock(status=302)
    redirected.getheader.return_value='/天气?q=明天'
    response = MagicMock(status=200)
    response.getheader.return_value='text/html'
    response.headers.get_content_charset.return_value='utf-8'
    response.read.return_value='<main>天气资料<a href="/北京/预报">北京预报</a><a href="javascript:alert(1)">无效</a></main>'.encode('utf-8')
    connection.return_value.getresponse.side_effect=[redirected,response]
    def request(method, target, headers):
        target.encode('ascii')
        headers['Host'].encode('ascii')
    connection.return_value.request.side_effect=request
    result=skill.web_fetch({'url':url})
    calls=connection.return_value.request.call_args_list
    assert calls[0].args[1] == encoded.removeprefix('https://www.baidu.com')
    assert calls[1].args[1] == '/%E5%A4%A9%E6%B0%94?q=%E6%98%8E%E5%A4%A9'
    assert '天气资料' in result['text']
    assert result['links']==[{'url':'https://www.baidu.com/%E5%8C%97%E4%BA%AC/%E9%A2%84%E6%8A%A5','title':'北京预报'}]
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
    assert [p['name'] for p in result['providers']]==['Google','Bing']

google = '<a href="/url?q=https%3A%2F%2Fexample.com%2Fweather"><h3>Weather</h3></a>'
baidu = '<h3 class="t"><a href="https://example.com/weather">天气</a></h3>'
with patch.object(skill, 'web_fetch', return_value={'text':baidu}) as fetch, patch.object(skill.socket, 'getaddrinfo', return_value=lookup('1.1.1.1')):
    result=skill.web_search({'query':'上海天气'})
    assert result['provider']=='Baidu'
    assert fetch.call_args.args[0]['url'].startswith('https://www.baidu.com/')
with patch.object(skill, 'web_fetch', return_value={'text':google + google}), patch.object(skill.socket, 'getaddrinfo', return_value=lookup('1.1.1.1')):
    result=skill.web_search({'query':'weather'})
    assert result['provider']=='Google'
    assert len(result['results'])==1
    assert result['results'][0]['url']=='https://example.com/weather'
fallback='<a class="result__a" href="https://example.com/weather">Weather</a>'
with patch.object(skill, 'web_fetch', side_effect=[OSError('unavailable'),{'text':'bad rss'},{'text':'no results'},{'text':fallback}]), patch.object(skill.socket, 'getaddrinfo', return_value=lookup('1.1.1.1')):
    result=skill.web_search({'query':'weather'})
    assert result['provider']=='DuckDuckGo'
    assert [p['name'] for p in result['providers']]==['Google','Bing','Baidu','DuckDuckGo']
`],{encoding:'utf8'})
  assert.equal(result.status,0,result.error?.message || result.stderr)
})
