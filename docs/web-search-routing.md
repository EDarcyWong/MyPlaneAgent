# 网页搜索入口与地区优先级

一般网页搜索先调用 `web_search`，从主流搜索引擎返回的链接中选择来源，再用 `web_fetch` 核对正文。百科、新闻、旅游等内容站点不作为默认搜索入口；用户明确指定网站、URL 或百科条目时仍可直接访问。

| 地区线索 | 优先顺序 |
| --- | --- |
| 中国大陆 | 百度 → Bing → 360 → 搜狗 → 神马 → Google → DuckDuckGo → Yahoo → Yandex → Naver |
| 韩国 | Naver → Google → Bing → DuckDuckGo → Yahoo → Yandex → 百度 → 360 → 搜狗 → 神马 |
| 俄罗斯 | Yandex → Google → Bing → DuckDuckGo → Yahoo → 百度 → 360 → 搜狗 → 神马 → Naver |
| 其他/未知地区 | Google → Bing → DuckDuckGo → Yahoo → Yandex → 百度 → 360 → 搜狗 → 神马 → Naver |

桌面应用根据系统 IANA 时区推断地区；时区没有地区信息时使用系统区域设置辅助判断。不调用 IP 定位服务，也不把提问语言当作用户位置。地区只是选择搜索服务的线索，无法准确识别 VPN 出口或旅行位置。

如需手动指定，可在启动应用的环境变量中设置 `MYPLANE_SEARCH_REGION=CN`、`KR`、`RU` 或 `GLOBAL`；默认 `AUTO`。示例：PowerShell 中设置 `$env:MYPLANE_SEARCH_REGION='GLOBAL'` 后启动应用。

不可用、页面无法解析或没有结果时依次尝试下一个引擎，获得非空结果后停止。搜索输出包含 `region`、`regionBasis`、`providers` 和实际引擎名称。搜索引擎页面会变化，抓取结果不等于已验证答案，仍需核对原始来源。已有显式 SearXNG 自定义端点配置继续生效。

`sm.cn` 使用 [神马移动搜索](https://m.sm.cn/)入口；用户提供的夸克与神马相同地址合并为一次请求。其余新增入口采用 [Yahoo Search](https://search.yahoo.com/)、[Yandex](https://yandex.com/)、[360](https://www.so.com/)、[搜狗](https://www.sogou.com/)和 [Naver](https://www.naver.com/)。

两条执行链路均覆盖：旧工具服务的 TypeScript 搜索和聊天 Agent 使用的 Python `agent-tools` 插件。应用为插件传入同一地区判断结果；已知旧版插件入口自动升级，用户自行编辑的插件代码继续保留。

验证：`npm run check`、`npm run build:electron`，然后 `node --test tests/search-engines.test.mjs tests/local-ai-web.test.mjs tests/agent-web-skill.test.mjs tests/core-chat.test.mjs`。

## 短期可用性调整

开启知识库时，按地区保存最近 24 小时的引擎可用性。连续两次失败或空结果才将引擎移到地区优先组末尾（中国大陆前五个、其他地区前三个），不会移除引擎。成功后恢复默认位置；过期样本不参与排序。设置 → 知识库可查看记录。此排序只反映近期搜索可用性，不认证答案内容。
