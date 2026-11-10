import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const forbidden = (name) => /^@stylai\/(ai|commerce|config|supabase)(\/|$)/.test(name) || /^(node:|bun:|fastify$|pg$|segmind$|@supabase\/)/.test(name)

/** A narrow import/dependency guardrail, not a complete security audit. */
export function checkBrowserBoundaries(root) {
  const web = resolve(root, "apps/web")
  const findings = []
  const manifest = JSON.parse(readFileSync(join(web, "package.json"), "utf8"))
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    if (forbidden(name)) findings.push(`apps/web declares server dependency ${name}`)
  }
  const scan = (directory, checkRelative) => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) { scan(file, checkRelative); continue }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
      const inspect = (node) => {
        let specifier
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) specifier = node.arguments[0].text
        if (specifier) {
          if (forbidden(specifier)) findings.push(`${file}: server import ${specifier}`)
          if (checkRelative && specifier.startsWith(".") && !resolve(dirname(file), specifier).startsWith(web + sep)) findings.push(`${file}: relative import escapes web workspace`)
        }
        ts.forEachChild(node, inspect)
      }
      inspect(ast)
    }
  }
  scan(join(web, "src"), true)
  scan(join(root, "packages/contracts/src"), false)
  return findings
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = checkBrowserBoundaries(resolve(dirname(fileURLToPath(import.meta.url)), ".."))
  for (const finding of findings) console.error(finding)
  if (findings.length) process.exitCode = 1
  else console.log("Browser/shared-contract server import guard passed.")
}
