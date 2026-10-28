// The static check of the kind `estilo` (the look of the site). Pure text in, verdict out: no Node imports.
// A stylesheet is only data, but an .astro file is code (its frontmatter runs at build time, a script or `set:html`
// reaches the visitor), so a model may change its markup, classes and literal attributes and never its code.
// Both the build and the station `codigo` run it, and the site is only rendered after it passes.
// No measured visual checks live here (colour, contrast, overlap): the reviewers judge those on screenshots.
// It changes how the site looks, never what it says: no new text, in the stylesheet (`content`) or in a component.

// Never in a stylesheet, nor in the styles of a component. A backslash would spell any of these with an escape.
const CSS_FORBIDDEN = [
  [/@\s*import/i, '@import'],
  [/url\s*\(/i, 'url('],
  [/image-set\s*\(|image\s*\(|cross-fade\s*\(|element\s*\(/i, 'an image function'],
  [/expression\s*\(/i, 'expression('],
  [/javascript\s*:|vbscript\s*:/i, 'javascript:'],
  [/(?<![\w-])behavior\s*:/i, 'behavior:'],
  [/-moz-binding/i, '-moz-binding'],
  [/<\s*\/\s*style/i, '</style'],
  [/:\/\//, '://'],
  [/\\/, 'a backslash escape'],
]

// Never in the template of a component (the CSS list applies too, for the `style` attributes).
const ASTRO_FORBIDDEN = [
  [/<\s*script/i, '<script'],
  [/set:html|set:text/i, 'set:html / set:text'],
  [/is:inline|is:raw/i, 'is:inline / is:raw'],
  [/\bon[a-z]+\s*=/i, 'an event handler (on…=)'],
  [/\bdata\s*:/i, 'data:'],
  [/\/\//, '//'],
  [/<\s*(iframe|object|embed|link|meta|base|form|slot|style|image|use|foreignobject)\b/i, 'a tag that loads or runs something'],
  [/\bimport\b/, 'import'],
  [/client:|define:vars/i, 'client: / define:vars'],
  [/&#|&colon|&tab;|&newline;/i, 'an HTML entity that can hide a scheme'],
]

// An attribute that points somewhere may only hold a path of this site (or an anchor): never a scheme or another host.
const LINK_ATTRIBUTE = /\b(?:xlink:)?(?:href|src|action|formaction|poster|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'{>]+))/gi
const LOCAL_LINK = /^(?:\/(?!\/)[^:\\]*|#[\w-]*)$/

const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script>/gi
const FENCES = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * @param {{path: string, content: string}[]} files the files as they would be written
 * @param {Record<string, string|null>} current the same paths as they are now (null: the file does not exist)
 * @returns {{ok: boolean, errors: string[]}}
 */
export function checkEstilo(files, current) {
  const errors = []
  for (const { path, content } of files) {
    const before = current[path]
    if (typeof before !== 'string') errors.push(`${path}: a file that does not exist yet cannot be created (modify only)`)
    else if (path.endsWith('.css')) errors.push(...cssErrors(path, content, before))
    else if (path.endsWith('.astro')) errors.push(...astroErrors(path, content, before))
    else errors.push(`${path}: only a stylesheet or an .astro component can change`)
  }
  return { ok: errors.length === 0, errors }
}

function cssErrors(path, text, before) {
  const errors = CSS_FORBIDDEN.filter(([pattern]) => pattern.test(text)).map(([, name]) => `${path}: ${name} is not allowed in a stylesheet`)
  const known = new Set(cssStrings(before))
  for (const value of new Set(cssStrings(text))) if (!known.has(value)) errors.push(`${path}: a new text «${value.slice(0, 40)}» in the stylesheet (estilo changes the look, never what the site says)`)
  return errors
}

// The quoted strings of a stylesheet (`content`, font names...). A backslash is refused anyway, so no escapes.
const cssStrings = (text) => [...text.matchAll(/(["'])([^\n]*?)\1/g)].map((m) => m[2])

function astroErrors(path, text, before) {
  const errors = []
  const { frontmatter, template } = split(text)
  const old = split(before)
  if (frontmatter !== old.frontmatter) errors.push(`${path}: the frontmatter is code and must stay exactly as it is`)

  // The scripts already in the component may stay byte for byte; any other one is new code.
  const known = old.template.match(SCRIPT_BLOCK) ?? []
  const { text: body, kept } = withoutKnownScripts(template, known)
  const rest = withoutKnownScripts(old.template, known).text
  if (/^\s*---\s*$/m.test(body)) errors.push(`${path}: a frontmatter fence inside the template`)

  const found = ASTRO_FORBIDDEN.concat(CSS_FORBIDDEN).filter(([pattern]) => pattern.test(body)).map(([, name]) => name)
  for (const name of new Set(found)) errors.push(`${path}: ${name} is not allowed in a component`)
  if (kept < known.length) errors.push(`${path}: the scripts of the component must stay exactly as they are`)

  for (const match of body.matchAll(LINK_ATTRIBUTE)) {
    const value = match[1] ?? match[2] ?? match[3]
    if (!LOCAL_LINK.test(value)) errors.push(`${path}: a link may only go to a path of the site, not «${value.slice(0, 40)}»`)
  }

  const tags = (t) => new Set([...t.matchAll(/<([A-Z][\w.]*)/g)].map((m) => m[1]))
  for (const tag of tags(body)) if (!tags(old.template).has(tag)) errors.push(`${path}: the component <${tag}> is not used in the current file`)

  const now = expressions(body)
  const was = expressions(rest)
  const same = (key) => JSON.stringify(now.found.map(key).sort()) === JSON.stringify(was.found.map(key).sort())
  if (now.error) errors.push(`${path}: ${now.error}`)
  else if (!same((e) => e.code)) errors.push(`${path}: the template expressions {…} are code and must stay as they are (they may move, not change)`)
  // Where a value lands decides what it can do: a text in the page is escaped, the same text in `style` or `href` is CSS or a link.
  else if (!same((e) => `${e.context} ${e.code}`)) errors.push(`${path}: a template expression {…} may move, never change its context (the text, or the attribute it fills)`)
  else if (JSON.stringify(words(body, now.found)) !== JSON.stringify(words(rest, was.found))) errors.push(`${path}: the text of the component changed (estilo changes the look, never what the site says)`)
  return errors
}

// Attributes whose value is read by people or by assistive technology: text, like the words between the tags.
const TEXT_ATTRIBUTE = /\b(alt|title|aria-label|aria-description|aria-roledescription|placeholder|label|value|content)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi

// The words a template shows, sorted: the code of the expressions, the comments and the tags left out, the text attributes in.
function words(template, found) {
  let text = template
  for (const { code } of found) text = text.replace(code, ' ')
  text = text.replace(/<!--[\s\S]*?-->/g, ' ')
  const attributes = [...text.matchAll(TEXT_ATTRIBUTE)].map((m) => `${m[1].toLowerCase()}=${m[2] ?? m[3]}`)
  const shown = text.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean)
  return [...shown, ...attributes].sort()
}

// The leading `---` fences are the frontmatter; the rest is the template. Whitespace before the fence is not a frontmatter.
function split(text) {
  const frontmatter = FENCES.exec(text)?.[0] ?? ''
  return { frontmatter, template: text.slice(frontmatter.length) }
}

// The template without the script blocks the current file already has (each one removed once, if it is there unchanged), and how many were there.
function withoutKnownScripts(template, known) {
  let text = template
  let kept = 0
  for (const block of known) {
    const at = text.indexOf(block)
    if (at === -1) continue
    text = text.slice(0, at) + text.slice(at + block.length)
    kept++
  }
  return { text, kept }
}

// The top-level `{…}` groups of a template, braces and quotes balanced. Everything inside is code.
// Each one with its context: `text`, or the attribute it is the value of (`attr:style`).
function expressions(template) {
  const found = []
  let depth = 0
  let start = 0
  let quote = null
  for (let i = 0; i < template.length; i++) {
    const c = template[i]
    if (depth === 0) {
      if (c === '{') [depth, start] = [1, i]
      else if (c === '}') return { found, error: 'a closing brace without its opening one' }
    } else if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) found.push({ code: template.slice(start, i + 1), context: contextAt(template, start) })
  }
  return depth === 0 ? { found } : { found, error: 'an opening brace that is never closed' }
}

function contextAt(template, start) {
  const before = template.slice(0, start).replace(/\s+$/, '')
  if (!before.endsWith('=')) return 'text'
  return `attr:${/([\w:.@-]+)\s*$/.exec(before.slice(0, -1))?.[1] ?? '?'}`
}
