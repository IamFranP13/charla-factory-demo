// Nothing a model writes may be imported by the platform. src/domain/ and src/features/ are editable by the factory
// (kinds bug, feature, cambio), so no entry point that runs in CI, in an Action or in the Cloudflare build (all of
// them with secrets in reach) may reach them through its import graph. Only the sandbox runs that code.
// Astro pages and components are exempt: they are the product, public and human-reviewed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const MODEL_CODE = ['src/domain/', 'src/features/']
const ENTRIES = [
  'scripts/factory.mjs', 'scripts/gate.mjs', 'scripts/validate-content.mjs', 'scripts/build-features.mjs',
  'scripts/deploy-meta.mjs', 'scripts/reset-demo.mjs', 'scripts/preflight.mjs', 'scripts/simulate.mjs', 'scripts/numbers.mjs',
]

const walk = (dir) =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`
    if (statSync(join(root, path)).isDirectory()) return walk(path)
    return /\.(m?js)$/.test(name) ? [path] : []
  })

// Tokenises just enough JavaScript to read imports without being fooled by text inside strings, templates,
// comments or regular expressions (lib/sandbox.js holds whole modules as template strings).
export function tokens(source) {
  const out = []
  let i = 0
  const prev = () => out.at(-1)
  const regexAllowed = () => {
    const p = prev()
    return !p || (p.type === 'punct' && !/^[)\]}]$/.test(p.value)) || (p.type === 'word' && /^(return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(p.value))
  }
  const template = () => {
    // at the opening backtick; skips to its closing one, running nested ${ } as code
    i++
    while (i < source.length && source[i] !== '`') {
      if (source[i] === '\\') i += 2
      else if (source[i] === '$' && source[i + 1] === '{') {
        i += 2
        let depth = 1
        while (i < source.length && depth > 0) {
          const c = source[i]
          if (c === '`') template()
          else if (c === "'" || c === '"') string(c)
          else {
            if (c === '{') depth++
            if (c === '}') depth--
            i++
          }
        }
      } else i++
    }
    i++
  }
  const string = (quote) => {
    let value = ''
    i++
    while (i < source.length && source[i] !== quote && source[i] !== '\n') {
      if (source[i] === '\\') {
        value += source[i + 1]
        i += 2
      } else value += source[i++]
    }
    i++
    return value
  }
  while (i < source.length) {
    const c = source[i]
    if (/\s/.test(c)) i++
    else if (c === '/' && source[i + 1] === '/') while (i < source.length && source[i] !== '\n') i++
    else if (c === '/' && source[i + 1] === '*') i = source.indexOf('*/', i + 2) + 2 || source.length
    else if (c === '`') {
      template()
      out.push({ type: 'template' })
    } else if (c === "'" || c === '"') out.push({ type: 'string', value: string(c) })
    else if (c === '/' && regexAllowed()) {
      i++
      let inClass = false
      while (i < source.length && (source[i] !== '/' || inClass) && source[i] !== '\n') {
        if (source[i] === '\\') i++
        else if (source[i] === '[') inClass = true
        else if (source[i] === ']') inClass = false
        i++
      }
      i++
      while (/[a-z]/.test(source[i] ?? '')) i++
      out.push({ type: 'regex' })
    } else if (/[\w$]/.test(c)) {
      let word = ''
      while (i < source.length && /[\w$]/.test(source[i])) word += source[i++]
      out.push({ type: 'word', value: word })
    } else {
      out.push({ type: 'punct', value: c })
      i++
    }
  }
  return out
}

/** Relative specifiers a module imports (static, re-exported or dynamic with a literal), plus dynamic ones it cannot read. */
export function importsOf(source) {
  const t = tokens(source)
  const specifiers = []
  const opaque = []
  for (let k = 0; k < t.length; k++) {
    const isWord = (n, w) => t[n]?.type === 'word' && t[n].value === w
    if (isWord(k, 'import') && t[k + 1]?.type === 'punct' && t[k + 1].value === '(') {
      if (t[k + 2]?.type === 'string' && t[k + 3]?.value === ')') specifiers.push(t[k + 2].value)
      else opaque.push('import(…)')
    } else if (isWord(k, 'import') && t[k + 1]?.value === '.') {
      continue // import.meta
    } else if (isWord(k, 'import') && t[k + 1]?.type === 'string') {
      specifiers.push(t[k + 1].value)
    } else if (isWord(k, 'import') || (isWord(k, 'export') && (t[k + 1]?.value === '*' || t[k + 1]?.value === '{'))) {
      for (let n = k + 1; n < t.length && !(t[n].type === 'punct' && t[n].value === ';'); n++) {
        if (isWord(n, 'from') && t[n + 1]?.type === 'string') {
          specifiers.push(t[n + 1].value)
          break
        }
        if (isWord(n, 'import') || isWord(n, 'export') || isWord(n, 'const') || isWord(n, 'function')) break
      }
    }
  }
  return { specifiers: specifiers.filter((s) => s.startsWith('.')), opaque }
}

function reach(entry) {
  const seen = new Map() // file -> who imported it
  const queue = [[entry, null]]
  const problems = []
  while (queue.length) {
    const [file, from] = queue.shift()
    if (seen.has(file)) continue
    seen.set(file, from)
    const { specifiers, opaque } = importsOf(readFileSync(join(root, file), 'utf8'))
    for (const what of opaque) problems.push(`${file}: ${what} cannot be followed`)
    for (const specifier of specifiers) {
      const target = relative(root, resolve(dirname(join(root, file)), specifier))
      if (!existsSync(join(root, target))) continue
      queue.push([target, file])
    }
  }
  return { files: [...seen.keys()], problems, seen }
}

const chain = (seen, file) => (file === null ? [] : [...chain(seen, seen.get(file)), file])

test('the scanner reads imports, not text that looks like imports', () => {
  const source = [
    "import a from './a.js'",
    "import { b } from '../b.js'",
    "export * from './c.js'",
    "export { d } from './d.js'",
    "import './e.js'",
    "const x = await import('./f.js')",
    "const t = `import z from './in-template.js'\n${`import y from './nested.js'`}`",
    "// import q from './comment.js'",
    "const re = /import w from '\\.\\/regex\\.js'/",
    "const s = \"import v from './string.js'\"",
    "import 'node:fs'",
    'const m = import.meta.url',
  ].join('\n')
  assert.deepEqual(importsOf(source), { specifiers: ['./a.js', '../b.js', './c.js', './d.js', './e.js', './f.js'], opaque: [] })
  assert.deepEqual(importsOf('await import(name)').opaque, ['import(…)'])
})

test('no platform entry point reaches src/domain/ or src/features/ through its imports', () => {
  const entries = [...ENTRIES, ...walk('lib'), ...walk('functions')]
  for (const entry of entries) {
    const { files, problems, seen } = reach(entry)
    assert.deepEqual(problems, [], entry)
    const bad = files.filter((f) => MODEL_CODE.some((dir) => f.startsWith(dir)))
    assert.deepEqual(bad.map((f) => chain(seen, f).join(' → ')), [], `${entry} reaches code a model can write`)
  }
})

test('the entry points that run with secrets exist (the walk is not vacuous)', () => {
  for (const entry of ENTRIES) assert.ok(existsSync(join(root, entry)), entry)
  assert.ok(reach('scripts/gate.mjs').files.includes('lib/github.js'))
  assert.ok(reach('scripts/factory.mjs').files.includes('lib/sandbox.js'))
})
