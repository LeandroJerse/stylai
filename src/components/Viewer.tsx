import { useRef } from "react"
import { X } from "@phosphor-icons/react"
import type { ImageAsset } from "../api/types"
import { useStore } from "../app/store"
import { Photo, useModal } from "./ui"

/** Full-screen image viewer (look or product photo). */
export function Viewer({ image, alt }: { image: ImageAsset; alt: string }) {
  const { close } = useStore()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useModal(panelRef, close, closeRef)
  return (
    <div className="sa-overlay">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Imagem ampliada" className="sa-fullscreen">
        <div className="flex items-center justify-end p-2" style={{ paddingTop: "max(8px, env(safe-area-inset-top))" }}>
          <button ref={closeRef} type="button" className="sa-iconbtn" aria-label="Fechar imagem" onClick={close}>
            <X size={24} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <Photo image={image} alt={alt} fit="contain" className="max-h-full max-w-full" eager />
        </div>
      </div>
    </div>
  )
}
