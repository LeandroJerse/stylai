import { describe, expect, test } from "bun:test"
import { INTRO_KEY, insetFor, introMode, introTimeline, introTotal, isTypingKey, markIntroSeen, pickTarget, shouldRunIntro } from "../src/lib/intro"

const mem = (seed: Record<string, string> = {}) => {
  const data = { ...seed }
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) }
}

describe("explorar opening rules", () => {
  test("runs once per session, only when the app opens on Explorar", () => {
    const s = mem()
    expect(shouldRunIntro({ reducedMotion: false, startTab: "explorar", storage: s })).toBe(true)
    markIntroSeen(s)
    expect(s.getItem(INTRO_KEY)).toBe("1")
    expect(shouldRunIntro({ reducedMotion: false, startTab: "explorar", storage: s })).toBe(false)
    expect(shouldRunIntro({ reducedMotion: false, startTab: "estudio", storage: mem() })).toBe(false)
  })

  test("never with prefers-reduced-motion (static screen)", () => {
    expect(shouldRunIntro({ reducedMotion: true, startTab: "explorar", storage: mem() })).toBe(false)
  })

  test("blocked storage does not break the app", () => {
    const broken = { getItem: () => { throw new Error("denied") }, setItem: () => { throw new Error("denied") } }
    expect(shouldRunIntro({ reducedMotion: false, startTab: "explorar", storage: broken })).toBe(true)
    expect(() => markIntroSeen(broken)).not.toThrow()
  })
})

describe("explorar opening timeline", () => {
  test("lasts 3 to 4 seconds in both variants", () => {
    for (const mode of ["full", "lite"] as const) {
      expect(introTotal(mode)).toBeGreaterThanOrEqual(3000)
      expect(introTotal(mode)).toBeLessThanOrEqual(4000)
    }
    expect(introTotal("full")).toBe(3600)
    expect(introTotal("lite")).toBe(3200)
  })

  test("narrative order: background first, message next, the thread under the search last", () => {
    for (const mode of ["full", "lite"] as const) {
      const steps = introTimeline(mode)
      const first = (part: string) => Math.min(...steps.filter((s) => s.part === part).map((s) => s.start))
      const messageIn = first(mode === "full" ? "words" : "title")
      expect(first("mark")).toBeLessThan(messageIn)
      expect(messageIn).toBeLessThan(first("message"))
      expect(first("message")).toBeLessThan(first("veil"))
      expect(first("veil")).toBeLessThan(first("seam"))
      // the seam is the last step and ends exactly when the layer is removed
      const seam = steps.find((s) => s.part === "seam")
      expect(seam && seam.start + seam.duration).toBe(introTotal(mode))
      // a held moment before the message leaves: time to look at it
      const words = steps.find((s) => s.part === (mode === "full" ? "words" : "title"))
      const wordsEnd = words ? words.start + (words.stagger ?? 0) * 5 + words.duration : 0
      expect(first("message") - wordsEnd).toBeGreaterThanOrEqual(100)
    }
  })

  test("in full mode the background panel rises from the bottom and composes into the hero", () => {
    const panel = introTimeline("full").filter((s) => s.part === "panel")
    expect(panel.map((s) => s.props[0])).toEqual(["clip-path", "clip-path", "opacity"])
    expect(panel[0]?.start).toBe(0)
  })

  test("the light variant only animates composited properties (no clip-path, no per-word stagger)", () => {
    const steps = introTimeline("lite")
    expect(steps.some((s) => s.props.includes("clip-path"))).toBe(false)
    expect(steps.some((s) => s.part === "words" || s.part === "panel")).toBe(false)
  })

  test("phones, data saver and low-end devices get the light variant", () => {
    expect(introMode({ width: 390 })).toBe("lite")
    expect(introMode({ width: 1440, saveData: true })).toBe("lite")
    expect(introMode({ width: 1440, cores: 2 })).toBe("lite")
    expect(introMode({ width: 1440, memoryGb: 2 })).toBe("lite")
    expect(introMode({ width: 1440, cores: 8, memoryGb: 8 })).toBe("full")
    expect(introMode({ width: 768 })).toBe("full")
  })
})

describe("explorar opening interaction helpers", () => {
  test("printable keys go to the search; shortcuts and navigation keys do not", () => {
    const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods })
    expect(isTypingKey(k("b"))).toBe(true)
    expect(isTypingKey(k("ç"))).toBe(true)
    expect(isTypingKey(k("Tab"))).toBe(false)
    expect(isTypingKey(k("Escape"))).toBe(false)
    expect(isTypingKey(k("c", { ctrlKey: true }))).toBe(false)
  })

  test("the thread lands on the search when it is on screen, else on the CTA that leads to it", () => {
    const view = { top: 64, bottom: 775 }
    expect(pickTarget({ x: 16, y: 600, width: 358, height: 52 }, { x: 32, y: 400, width: 300, height: 48 }, view)).toBe("search")
    expect(pickTarget({ x: 16, y: 870, width: 358, height: 52 }, { x: 32, y: 631, width: 326, height: 48 }, view)).toBe("cta")
    expect(pickTarget({ x: 16, y: 870, width: 358, height: 52 }, { x: 32, y: 900, width: 326, height: 48 }, view)).toBe(null)
  })

  test("clip insets keep exactly the hero rectangle", () => {
    expect(insetFor({ x: 32, y: 96, width: 1376, height: 486 }, { width: 1440, height: 900 }, 28)).toBe("inset(96px 32px 318px 32px round 28px)")
  })
})
