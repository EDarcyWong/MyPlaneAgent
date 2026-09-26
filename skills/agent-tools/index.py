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


def safe_public_url(url, proxy_mapping=False):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Only public HTTP/HTTPS URLs are allowed')
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

    def handle_starttag(self, tag, attrs):
        if self.hidden_depth:
            self.hidden_depth += 1
        elif tag in self.HIDDEN:
            self.hidden_depth = 1
        elif tag in self.BLOCK:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if self.hidden_depth:
            self.hidden_depth -= 1
        elif tag in self.BLOCK:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.hidden_depth and data.strip():
            self.parts.append(data.strip())

    def text(self):
        return '\n'.join(' '.join(line.split()) for line in ''.join(
            part if part == '\n' else ' ' + part + ' ' for part in self.parts
        ).splitlines() if line.strip())


def web_fetch(args, redirects=0, raw_html=False):
    url = args['url']
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
        if kind == 'text/html' and not raw_html:
            parser = WebPageText()
            parser.feed(content)
            content = parser.text()
            if not content:
                raise ValueError('Web page has no readable text')
        return {'url': url, 'contentType': kind, 'text': content[:maximum], 'truncated': len(raw) > 2_000_000 or len(content) > maximum}
    finally:
        if connection is not None:
            connection.close()
        else:
            raw_socket.close()


class SearchLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.current = None
    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'a' and 'result__a' in attributes.get('class', ''):
            self.current = {'url': attributes.get('href', ''), 'title': ''}
    def handle_data(self, data):
        if self.current is not None:
            self.current['title'] += data
    def handle_endtag(self, tag):
        if tag == 'a' and self.current is not None:
            self.links.append(self.current)
            self.current = None


def web_search(args):
    query = str(args['query']).strip()
    if not query or len(query) > 300:
        raise ValueError('Search query must have 1–300 characters')
    url = 'https://html.duckduckgo.com/html/?' + urllib.parse.urlencode({'q': query})
    links = []
    try:
        page = web_fetch({'url': url, 'maxCharacters': 30000}, raw_html=True)
        parser = SearchLinks()
        parser.feed(page['text'])
        links = parser.links
    except (ValueError, OSError):
        pass
    provider = 'DuckDuckGo'
    if not links:
        provider = 'Bing'
        page = web_fetch({'url': 'https://www.bing.com/search?' + urllib.parse.urlencode({'format': 'rss', 'q': query, 'mkt': 'zh-CN', 'setlang': 'zh-hans'}), 'maxCharacters': 30000})
        document = ElementTree.fromstring(page['text'])
        links = [{'url': item.findtext('link', ''), 'title': item.findtext('title', ''), 'snippet': item.findtext('description', '')} for item in document.findall('./channel/item')]
    rows = []
    for link in links:
        target = link['url']
        parsed = urllib.parse.urlparse(target)
        if parsed.path == '/l/':
            target = urllib.parse.parse_qs(parsed.query).get('uddg', [''])[0]
        try:
            safe_public_url(target, proxy_mapping=bool(urllib.request.getproxies().get(urllib.parse.urlparse(target).scheme)))
        except Exception:
            continue
        rows.append({'title': link['title'].strip(), 'url': target, 'snippet': link.get('snippet', '')[:1200]})
        if len(rows) >= max(1, min(10, int(args.get('limit', 5)))):
            break
    return {'query': query, 'provider': provider, 'results': rows, **({'message': '搜索站点没有返回可用结果，请调整关键词或稍后重试。'} if not rows else {})}


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
