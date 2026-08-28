import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Glob } from "bun"

const dir = join(import.meta.dir, "..")

const Bump = {
  major: "major",
  minor: "minor",
  patch: "patch",
} as const
type Bump = (typeof Bump)[keyof typeof Bump]

function current(): string {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  return pkg.version
}

async function bump(input: Bump | string) {
  const version = input in Bump ? apply(current(), input as Bump) : input

  const files = await Array.fromAsync(
    new Glob("**/package.json").scan({ cwd: dir, absolute: true })
  ).then((arr) => arr.filter((f) => !f.includes("node_modules") && !f.includes("dist") && !f.includes(".cache")))

  for (const file of files) {
    const text = await Bun.file(file).text()
    const stamped = text.replace(/"version": "[^"]+"/g, `"version": "${version}"`)
    await Bun.file(file).write(stamped)
    console.log(`stamped ${version} -> ${file}`)
  }

  // also update optionalDependencies in root package.json to match
  const root = join(dir, "package.json")
  const pkg = await Bun.file(root).json()
  if (pkg.optionalDependencies) {
    for (const key of Object.keys(pkg.optionalDependencies)) {
      pkg.optionalDependencies[key] = version
    }
    await Bun.file(root).write(JSON.stringify(pkg, null, 2) + "\n")
    console.log(`stamped optionalDependencies -> ${version}`)
  }

  return version
}

function apply(current: string, type: Bump) {
  const [major, minor, patch] = current.split(".").map((x) => Number(x) || 0)
  if (type === "major") return `${major + 1}.0.0`
  if (type === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

export { Bump, bump, current }
