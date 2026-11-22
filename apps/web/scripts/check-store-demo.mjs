import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('http://localhost:5192/?catalogo=referencias#/explorar')
  const card = page.getByRole('button', { name: /Blusa manga longa azul-marinho.*Ver detalhes/ })
  await card.waitFor({ timeout: 30000 })
  const images = page.locator('img[src*="store-garments/"]')
  await images.first().waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('img[src*="store-garments/"]')].every(i => i.complete && i.naturalWidth > 0))
  await card.click()
  const link = page.getByRole('link', { name: /Ver na SHEIN Brasil/ })
  if (!(await link.getAttribute('href')).includes('17168386.html')) throw new Error('Incorrect product link')
  if (!(await page.getByTestId('test-product-note').textContent()).includes('foto e link')) throw new Error('Missing reference notice')
  mkdirSync('test-results/store-catalog', { recursive: true })
  await page.screenshot({ path: 'test-results/store-catalog/product.png' })
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('PASS: store catalog renders, local images load, product detail links to the matching SHEIN listing; no JS errors.')
} finally {
  await browser.close()
}
