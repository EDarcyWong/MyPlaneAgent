/** Format display copies only. Unparseable historic files remain readable as-is. */
export async function formatCodePreview(code: string, filename = 'module.js'): Promise<string> {
  const typescript = /\.[cm]?tsx?$/i.test(filename)
  const json = /\.json$/i.test(filename)
  if (!typescript && !json && !/\.[cm]?jsx?$/i.test(filename)) return code
  try {
    const [{ format }, parser, estree] = await Promise.all([
      import('prettier/standalone'),
      typescript ? import('prettier/plugins/typescript') : import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
    ])
    return await format(code, {
      parser: typescript ? 'typescript' : json ? 'json' : 'babel',
      plugins: [parser, estree], tabWidth: 2, useTabs: false, printWidth: 90,
      singleQuote: true, semi: false, trailingComma: 'all', endOfLine: 'lf',
    })
  } catch { return code }
}
