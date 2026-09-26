#!/usr/bin/env python3
"""Agent Core Skill runtime for workspace tools migrated from the old Agent."""
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request
import base64
import socket
import ipaddress
import http.client
import ssl
from html.parser import HTMLParser
from xml.etree import ElementTree

import engine

WRITE_TOOLS = {'write_file', 'replace_text', 'apply_patch', 'create_document', 'create_spreadsheet', 'run_command', 'run_test'}


def encoded_public_url(url):
    if any(ord(char) < 32 or ord(char) == 127 for char in url):
        raise ValueError('Control characters are not allowed in URLs')
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Only public HTTP/HTTPS URLs are allowed')
    hostname = parsed.hostname.encode('idna').decode('ascii')
    authority = '[' + hostname + ']' if ':' in hostname else hostname
    if parsed.port is not None:
        authority += ':' + str(parsed.port)
    # Preserve existing escapes and query separators (including +); encode only
    # characters that cannot be sent in an HTTP request target.
    quote = lambda value: urllib.parse.quote(value, safe="/%:@!$&'()*+,;=-._~?")
    return urllib.parse.urlunparse((parsed.scheme, authority, quote(parsed.path), quote(parsed.params), quote(parsed.query), ''))


def safe_public_url(url, proxy_mapping=False):
    parsed = urllib.parse.urlparse(encoded_public_url(url))
    hostname = parsed.hostname.lower().rstrip('.')
    if hostname == 'localhost' or hostname.endswith(('.localhost', '.local', '.internal')):
        raise ValueError('Local hostnames are not allowed')
    try:
        ipaddress.ip_address(hostname)
        literal = True
    except ValueError:
        literal = False
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    addresses = []
    for info in socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM):
        ip = ipaddress.ip_address(info[4][0])
        fake_mapping = proxy_mapping and not literal and ip.version == 4 and ip in ipaddress.ip_network('198.18.0.0/15')
        if not ip.is_global and not fake_mapping:
            raise ValueError('Private, loopback and local addresses are not allowed')
        addresses.append(parsed.hostname if fake_mapping else info[4][0])
    if not addresses:
        raise ValueError('Cannot resolve host')
    return parsed, port, addresses[0]


class WebPageText(HTMLParser):
    HIDDEN = {'script', 'style', 'svg', 'nav', 'footer', 'noscript'}
    BLOCK = {'br', 'div', 'p', 'li', 'tr', 'section', 'article', 'main', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden_depth = 0
        self.links = []
        self.link = None

    def handle_starttag(self, tag, attrs):
        if tag == 'a' and not self.hidden_depth:
            self.link = {'url': dict(attrs).get('href', ''), 'title': ''}
        if self.hidden_depth:
            self.hidden_depth += 1
        elif tag in self.HIDDEN:
            self.hidden_depth = 1
        elif tag in self.BLOCK:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag == 'a' and self.link is not None:
            if self.link['url'] and len(self.links) < 300:
                self.links.append(self.link)
            self.link = None
        if self.hidden_depth:
            self.hidden_depth -= 1
        elif tag in self.BLOCK:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.hidden_depth and data.strip():
            self.parts.append(data.strip())
            if self.link is not None:
                self.link['title'] += data.strip() + ' '

    def text(self):
        return '\n'.join(' '.join(line.split()) for line in ''.join(
            part if part == '\n' else ' ' + part + ' ' for part in self.parts
        ).splitlines() if line.strip())


def web_fetch(args, redirects=0, raw_html=False):
    url = encoded_public_url(args['url'])
    scheme = urllib.parse.urlparse(url).scheme
    proxy_url = urllib.request.getproxies().get(scheme)
    proxy = urllib.parse.urlparse(proxy_url) if proxy_url else None
    use_proxy = bool(proxy and proxy.scheme == 'http' and proxy.hostname)
    parsed, port, address = safe_public_url(url, proxy_mapping=use_proxy)
    maximum = max(1000, min(30000, int(args.get('maxCharacters', 12000))))
    if use_proxy:
        tunnel = http.client.HTTPConnection(proxy.hostname, proxy.port or 80, timeout=15)
        headers = {}
        if proxy.username:
            credentials = urllib.parse.unquote(proxy.username) + ':' + urllib.parse.unquote(proxy.password or '')
            headers['Proxy-Authorization'] = 'Basic ' + base64.b64encode(credentials.encode()).decode()
        tunnel.set_tunnel(address, port, headers=headers)
        tunnel.connect()
        raw_socket = tunnel.sock
    else:
        raw_socket = socket.create_connection((address, port), timeout=15)
    connection = None
    try:
        if parsed.scheme == 'https':
            tls = ssl.create_default_context()
            # Python.org macOS installations may not have a configured CA bundle.
            if sys.platform == 'darwin' and pathlib.Path('/etc/ssl/cert.pem').is_file():
                tls.load_verify_locations('/etc/ssl/cert.pem')
            wrapped = tls.wrap_socket(raw_socket, server_hostname=parsed.hostname)
            connection = http.client.HTTPSConnection(parsed.hostname, port, timeout=15)
            connection.sock = wrapped
        else:
            connection = http.client.HTTPConnection(parsed.hostname, port, timeout=15)
            connection.sock = raw_socket
        target = urllib.parse.urlunparse(('', '', parsed.path or '/', parsed.params, parsed.query, ''))
        connection.request('GET', target, headers={'Host': parsed.netloc, 'User-Agent': 'MyPlaneAgent/1.0'})
        response = connection.getresponse()
        if response.status in (301, 302, 303, 307, 308) and response.getheader('location'):
            if redirects >= 4:
                raise ValueError('Too many redirects')
            return web_fetch({**args, 'url': urllib.parse.urljoin(url, response.getheader('location'))}, redirects + 1, raw_html)
        if response.status >= 300:
            raise ValueError(f'HTTP {response.status}')
        kind = response.getheader('content-type', 'text/plain').split(';', 1)[0].strip().lower()
        if kind not in ('text/html', 'text/plain', 'application/json', 'application/xml', 'text/xml', 'application/rss+xml'):
            raise ValueError('Response is not text')
        raw = response.read(2_000_001)
        charset = response.headers.get_content_charset() or 'utf-8'
        content = raw.decode(charset, 'replace')
        links = []
        if kind == 'text/html' and not raw_html:
            parser = WebPageText()
            parser.feed(content)
            content = parser.text()
            seen = set()
            for link in parser.links:
                try:
                    href = encoded_public_url(urllib.parse.urljoin(url, link['url']))
                    if href in seen:
                        continue
                    seen.add(href)
                    links.append({'url': href, 'title': link['title'].strip()[:200]})
                    if len(links) >= 60:
                        break
                except ValueError:
                    continue
            if not content:
                raise ValueError('Web page has no readable text')
        return {'url': url, 'contentType': kind, 'text': content[:maximum], 'truncated': len(raw) > 2_000_000 or len(content) > maximum, **({'links': links, 'linksNote': '页面链接仅供导航参考，未访问核验；读取时仍需执行公网地址校验。'} if links else {})}
    finally:
        if connection is not None:
            connection.close()
        else:
            raw_socket.close()


class SearchLinks(HTMLParser):
    def __init__(self, provider='DuckDuckGo'):
        super().__init__()
        self.links = []
        self.current = None
        self.provider = provider
        self.heading = False
        self.result = False
    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'h3':
            self.heading = True
            if self.current is not None:
                self.result = True
        if tag == 'a':
            self.current = {'url': attributes.get('href', ''), 'title': ''}
            self.result = self.heading or 'result__a' in attributes.get('class', '')
    def handle_data(self, data):
        if self.current is not None:
            self.current['title'] += data
    def handle_endtag(self, tag):
        if tag == 'a' and self.current is not None:
            if self.result:
                self.links.append(self.current)
            self.current = None
        if tag == 'h3':
            self.heading = False


def web_search(args):
    query = str(args['query']).strip()
    if not query or len(query) > 300:
        raise ValueError('Search query must have 1–300 characters')
    engines = {
        'Google': 'https://www.google.com/search?' + urllib.parse.urlencode({'q': query, 'num': 10}),
        'Bing': 'https://www.bing.com/search?' + urllib.parse.urlencode({'format': 'rss', 'q': query, 'mkt': 'zh-CN'}),
        'Baidu': 'https://www.baidu.com/s?' + urllib.parse.urlencode({'wd': query, 'rn': 10}),
        'DuckDuckGo': 'https://html.duckduckgo.com/html/?' + urllib.parse.urlencode({'q': query}),
    }
    order = ['Baidu', 'Bing', 'Google'] if any('\u3400' <= char <= '\u9fff' for char in query) else ['Google', 'Bing', 'Baidu']
    providers = []
    for provider in order + ['DuckDuckGo']:
        try:
            page = web_fetch({'url': engines[provider], 'maxCharacters': 30000}, raw_html=True)
            if provider == 'Bing':
                document = ElementTree.fromstring(page['text'])
                links = [{'url': item.findtext('link', ''), 'title': item.findtext('title', ''), 'snippet': item.findtext('description', '')} for item in document.findall('./channel/item')]
            else:
                parser = SearchLinks(provider)
                parser.feed(page['text'])
                links = parser.links
            rows = search_rows(links, provider, args.get('limit', 5))
            providers.append({'name': provider, 'status': 'ok', 'count': len(rows)})
            if rows:
                return {'query': query, 'provider': provider, 'providers': providers, 'results': rows}
        except (ValueError, OSError, ElementTree.ParseError):
            providers.append({'name': provider, 'status': 'failed'})
    return {'query': query, 'provider': 'multi-engine', 'providers': providers, 'results': [], 'message': '主流搜索引擎及备用引擎均未返回可用结果，请调整关键词或稍后重试。'}


def search_rows(links, provider, limit):
    rows, seen = [], set()
    for link in links:
        target = link['url']
        parsed = urllib.parse.urlparse(target)
        if provider == 'Google' and parsed.path == '/url':
            params = urllib.parse.parse_qs(parsed.query)
            target = params.get('q', params.get('url', ['']))[0]
        if parsed.path == '/l/':
            target = urllib.parse.parse_qs(parsed.query).get('uddg', [''])[0]
        try:
            safe_public_url(target, proxy_mapping=bool(urllib.request.getproxies().get(urllib.parse.urlparse(target).scheme)))
        except Exception:
            continue
        target = urllib.parse.urldefrag(target)[0]
        if target in seen:
            continue
        seen.add(target)
        rows.append({'title': link['title'].strip(), 'url': target, 'snippet': link.get('snippet', '')[:1200], 'engine': provider})
        if len(rows) >= max(1, min(10, int(limit))):
            break
    return rows


def execute(tool, args, workspace):
    root = pathlib.Path(workspace).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Workspace does not exist')
    if tool == 'web_search':
        return web_search(args)
    if tool == 'web_fetch':
        return web_fetch(args)
    if tool == 'inspect_build':
        package = root / 'package.json'
        scripts = json.loads(package.read_text('utf-8')).get('scripts', {}) if package.is_file() else {}
        return {'scripts': {key: value for key, value in scripts.items() if key.split(':')[0] in ('test', 'check', 'lint', 'build')}, 'python': (root / 'pyproject.toml').is_file()}
    if tool == 'build_project':
        action = args['action']
        return execute('run_test', {'script': action, 'timeoutSeconds': args.get('timeoutSeconds', 120)}, workspace)
    context = {'workspace': str(root)}
    if tool in WRITE_TOOLS:
        prepared = engine.prepare_write(root, tool, args)
        return json.loads(engine.execute_plan(root, prepared['plan']))
    result = engine.builtin(tool, args, context)
    return json.loads(result) if isinstance(result, str) else result


def main():
    if '--runtime-mode' not in sys.argv:
        raise SystemExit('Use --runtime-mode')
    print('READY', flush=True)
    for line in sys.stdin:
        request_id = ''
        start = time.monotonic()
        try:
            request = json.loads(line)
            request_id = request['id']
            original_resolve = engine.resolve
            if request.get('context', {}).get('allowExternalPaths') is True:
                def granted_resolve(root, value, missing=False):
                    if not isinstance(value, str) or not value.strip() or '\0' in value:
                        raise ValueError('Invalid file path')
                    target = (root / value).resolve(strict=not missing)
                    return target
                engine.resolve = granted_resolve
            try:
                output = execute(request['tool'], request.get('args', {}), request['workspace'])
            finally:
                engine.resolve = original_resolve
            response = {'type': 'response', 'id': request_id, 'output': output, 'elapsedMs': int((time.monotonic() - start) * 1000)}
        except Exception as error:
            response = {'type': 'response', 'id': request_id, 'error': f'{type(error).__name__}: {error}', 'elapsedMs': int((time.monotonic() - start) * 1000)}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
