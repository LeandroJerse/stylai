/** Operator-only, bounded AliExpress image authorization. Default: validate without database writes. */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"
import { z } from "zod"

const hostedUrl = (hosts: string[]) => z.string().url().refine((value) => {
  const u = new URL(value)
  return u.protocol === "https:" && !u.username && !u.password && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
})
const schema = z.object({
  evidence: z.string().trim().min(20).max(350), authorizedAt: z.iso.datetime(),
  items: z.array(z.object({
    externalProductId: z.string().regex(/^\d+$/), seller: z.string().regex(/^aliexpress-shop-\d+$/),
    sellerName: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(160),
    category: z.enum(["shirts", "tops", "pants", "bottoms", "jackets", "dresses"]),
    imageUrl: hostedUrl(["alicdn.com", "aliexpress-media.com"]),
    productUrl: hostedUrl(["aliexpress.com", "aliexpress.us"]),
    priceMinor: z.number().int().nonnegative().nullable(), observedAt: z.iso.datetime(),
  }).strict()).min(1).max(12),
}).strict().refine((m) => new Set(m.items.map((i) => i.externalProductId)).size === m.items.length, "Duplicate product")
export const validateSourceReferences = (input: unknown) => schema.parse(input)
type Manifest = z.infer<typeof schema>
export function validateExistingSourceOwner(rows: { id: string; partner_id: string }[], partnerId: string): void {
  if (rows.length > 1) throw new Error("Ambiguous existing source product")
  if (rows[0] && rows[0].partner_id !== partnerId) throw new Error("Source product seller changed; separate review required")
}

export async function importSourceReferences(input: Manifest, options: { mode: "dry_run" | "commit"; databaseUrl?: string }) {
  const manifest = validateSourceReferences(input)
  const report = { mode: options.mode, items: manifest.items.map((i) => ({ externalProductId: i.externalProductId,
    priceMinor: i.priceMinor, referenceKind: "image_reference" as const })) }
  if (options.mode === "dry_run") return report
  const databaseUrl = options.databaseUrl ?? process.env.STYLAI_ADMIN_DATABASE_URL
  if (!databaseUrl) throw new Error("STYLAI_ADMIN_DATABASE_URL required for commit")
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 })
  await client.connect()
  try {
    await client.query("begin")
    for (const item of manifest.items) {
      const partner = (await client.query<{ id: string }>(`insert into public.partners(source,external_seller_id,region,name)
        values ('aliexpress',$1,'BR',$2) on conflict(source,region,external_seller_id) do update set name=excluded.name returning id`,
      [item.seller, item.sellerName])).rows[0]!.id
      // Refuse ambiguous pre-existing commerce rather than replacing a supplier SKU or granting it new rights.
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`aliexpress:${item.externalProductId}`])
      const existing = await client.query<{ id: string; partner_id: string }>(`select p.id,p.partner_id from public.products p join public.partners pa on pa.id=p.partner_id
        where pa.source='aliexpress' and p.external_product_id=$1 for update of p`, [item.externalProductId])
      validateExistingSourceOwner(existing.rows, partner)
      if (existing.rows[0]) {
        const variants = await client.query("select 1 from public.product_variants where product_id=$1 and kind<>'image_reference'", [existing.rows[0].id])
        if (variants.rowCount) throw new Error("Existing supplier SKUs require separate review")
        const images = await client.query("select 1 from public.product_images where product_id=$1 and url<>$2", [existing.rows[0].id, item.imageUrl])
        if (images.rowCount) throw new Error("Changed reference image requires separate review")
      }
      const product = (await client.query<{ id: string }>(`insert into public.products(partner_id,external_product_id,category_id,name,
        price_minor,currency,product_url,availability,published,rights_cleared,fixture,source_updated_at)
        values($1,$2,$3,$4,$5,'BRL',$6,'unknown',true,true,false,$7)
        on conflict(partner_id,external_product_id) do update set name=excluded.name,category_id=excluded.category_id,
          price_minor=excluded.price_minor,product_url=excluded.product_url,source_updated_at=excluded.source_updated_at,
          published=true,rights_cleared=true returning id`,
      [partner, item.externalProductId, item.category, item.name, item.priceMinor, item.productUrl, item.observedAt])).rows[0]!.id
      const variant = (await client.query<{ id: string }>(`insert into public.product_variants(product_id,external_variant_id,label,available,kind)
        values($1,'stylai:image-reference','Referência visual; tamanho não informado',null,'image_reference')
        on conflict(product_id,external_variant_id) do update set label=excluded.label returning id`, [product])).rows[0]!.id
      const image = (await client.query<{ id: string }>(`insert into public.product_images(product_id,variant_id,url,position)
        values($1,$2,$3,0) on conflict(product_id,position) do update set variant_id=excluded.variant_id
        where public.product_images.url=excluded.url returning id`, [product, variant, item.imageUrl])).rows[0]?.id
      if (!image) throw new Error("Existing image differs from authorization")
      await client.query(`insert into private.catalog_image_rights(image_id,basis,evidence,try_on_allowed)
        values($1,'owner_authorized',$2,true) on conflict(image_id) do update set evidence=excluded.evidence,try_on_allowed=true,recorded_at=now()`,
      [image, `Operator partnership declaration (not independently verified), ${manifest.authorizedAt}: ${manifest.evidence}`])
    }
    await client.query("commit")
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally { await client.end() }
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"))
  if (!file) throw new Error("Usage: import-authorized-source-references.ts manifest.json [--commit]")
  const result = await importSourceReferences(validateSourceReferences(JSON.parse(readFileSync(file, "utf8"))),
    { mode: process.argv.includes("--commit") ? "commit" : "dry_run" })
  console.log(JSON.stringify(result))
}
