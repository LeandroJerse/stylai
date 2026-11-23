/**
 * Transactional, idempotent importer for the curated real-garment pilot catalog (P1).
 * Default mode is dry_run (never writes unless --commit is explicitly passed).
 * Does NOT reset the database, touch passwords, or delete existing catalog rows.
 *
 * Usage:
 *   node --import tsx scripts/import-pilot-catalog.ts <manifest.json>            # dry_run
 *   node --import tsx scripts/import-pilot-catalog.ts <manifest.json> --commit   # upsert
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"
import { PILOT_SELLER_ID, PILOT_SELLER_NAME, validatePilotCatalog, type PilotCatalogManifest } from "@stylai/contracts"

export interface PilotImportReport {
  mode: "dry_run" | "commit"
  batchId: string
  seller: string
  approved: { externalProductId: string; name: string; category: string; basis: string }[]
}

const DB_BASIS: Record<string, "owner_authorized" | "licensed"> = {
  owner_authorized: "owner_authorized",
  cc0: "licensed",
  public_domain: "licensed",
}

export async function importPilotCatalog(
  manifest: PilotCatalogManifest,
  opts: { mode: "dry_run" | "commit"; databaseUrl?: string },
): Promise<PilotImportReport> {
  const approved = manifest.items.map((item) => ({
    externalProductId: item.externalProductId,
    name: item.name,
    category: item.category,
    basis: item.rights.basis,
  }))
  if (opts.mode === "dry_run") {
    return { mode: "dry_run", batchId: manifest.batchId, seller: manifest.seller, approved }
  }
  const dbUrl = opts.databaseUrl ?? process.env.STYLAI_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL
  if (!dbUrl) throw new Error("STYLAI_ADMIN_DATABASE_URL or DATABASE_URL is required for --commit")

  const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 10_000 })
  await client.connect()
  try {
    await client.query("begin")
    const partnerRes = await client.query<{ id: string }>(
      `insert into public.partners (source, external_seller_id, region, name)
       values ('curated', $1, 'BR', $2)
       on conflict (source, region, external_seller_id) do update set name = excluded.name
       returning id`,
      [PILOT_SELLER_ID, PILOT_SELLER_NAME],
    )
    const partnerId = partnerRes.rows[0]?.id
    if (!partnerId) throw new Error("Failed to upsert pilot partner")

    for (const item of manifest.items) {
      const prodRes = await client.query<{ id: string }>(
        `insert into public.products (
           partner_id, external_product_id, category_id, name,
           price_minor, currency, product_url, availability, published, rights_cleared, fixture
         )
         values ($1, $2, $3, $4, null, 'BRL', null, 'unknown', true, true, false)
         on conflict (partner_id, external_product_id) do update set
           category_id = excluded.category_id,
           name = excluded.name,
           price_minor = null,
           product_url = null,
           availability = 'unknown',
           published = true,
           rights_cleared = true,
           fixture = false
         returning id`,
        [partnerId, item.externalProductId, item.category, item.name],
      )
      const productId = prodRes.rows[0]?.id
      if (!productId) throw new Error(`Failed to upsert pilot product ${item.externalProductId}`)

      await client.query(
        `insert into public.product_variants (product_id, external_variant_id, label, available)
         values ($1, $2, $3, true)
         on conflict (product_id, external_variant_id) do update set label = excluded.label, available = true`,
        [productId, `${item.externalProductId}-v1`, item.variantLabel],
      )

      const imgRes = await client.query<{ id: string }>(
        `insert into public.product_images (product_id, url, position)
         values ($1, $2, 0)
         on conflict do nothing
         returning id`,
        [productId, item.imageUrl],
      )
      const imageId = imgRes.rows[0]?.id ?? (
        await client.query<{ id: string }>("select id from public.product_images where product_id = $1 and url = $2 limit 1", [productId, item.imageUrl])
      ).rows[0]?.id
      if (!imageId) throw new Error(`Failed to resolve product_images row for ${item.externalProductId}`)

      const evidenceText = [
        `[${item.rights.licenseLabel}]`,
        item.rights.evidence,
        item.rights.sourcePageUrl ? `Origem: ${item.rights.sourcePageUrl}` : null,
        item.rights.author ? `Autor: ${item.rights.author}` : null,
        `Verificado em ${item.rights.verifiedAt} por ${item.rights.reviewer}.`,
      ].filter(Boolean).join(" ")

      await client.query(
        `insert into private.catalog_image_rights (image_id, basis, evidence, try_on_allowed)
         values ($1, $2, $3, true)
         on conflict (image_id) do update set basis = excluded.basis, evidence = excluded.evidence, try_on_allowed = true`,
        [imageId, DB_BASIS[item.rights.basis] ?? "licensed", evidenceText],
      )
    }
    await client.query("commit")
  } catch (err) {
    await client.query("rollback").catch(() => undefined)
    throw err
  } finally {
    await client.end()
  }
  return { mode: "commit", batchId: manifest.batchId, seller: manifest.seller, approved }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith("--"))
  const commit = args.includes("--commit")
  if (!file) {
    console.error("Usage: node --import tsx scripts/import-pilot-catalog.ts <manifest.json> [--commit]")
    process.exit(2)
  }
  const raw: unknown = JSON.parse(readFileSync(resolve(file), "utf8"))
  const manifest = validatePilotCatalog(raw)
  const report = await importPilotCatalog(manifest, { mode: commit ? "commit" : "dry_run" })
  console.log(JSON.stringify(report, null, 2))
}
