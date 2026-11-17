/**
 * Shared value controls: read-only star rating, minimum-rating threshold (stars + decimal
 * field) and single-handle slider with a synced numeric field. Used by Perfil and Estúdio.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Star } from "@phosphor-icons/react";

const dec1 = (v: number): string =>
  v.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

/** One star with partial fill (0–1). */
function StarGlyph({ fill, size }: { fill: number; size: number }) {
  return (
    <span className="sa-star" style={{ width: size, height: size }}>
      <Star size={size} weight="regular" className="sa-star-empty" />
      {fill > 0 ? (
        <span
          className="sa-star-fill"
          style={{ width: `${Math.min(1, fill) * 100}%` }}
        >
          <Star size={size} weight="fill" />
        </span>
      ) : null}
    </span>
  );
}

/** Read-only rating (0–5). A missing rating is never drawn as zero stars: callers show text instead. */
export function StarRating({
  value,
  size = 16,
}: {
  value: number;
  size?: number;
}) {
  return (
    <span
      className="inline-flex items-center gap-2"
      role="img"
      aria-label={`${dec1(value)} de 5 estrelas`}
    >
      <span className="sa-stars" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <StarGlyph key={n} fill={value - (n - 1)} size={size} />
        ))}
      </span>
      <span className="sa-num font-semibold" aria-hidden="true">
        {dec1(value)}
      </span>
    </span>
  );
}

const parseNumber = (raw: string): number =>
  Number(
    raw
      .replace(/\s/g, "")
      .replace(/\.(?=\d{3}\b)/g, "")
      .replace(",", ".")
      .replace(/[^\d.]/g, ""),
  );

/** Keeps a text draft while typing; commits only valid numbers inside [min, max]; clamps on blur. */
function useNumberDraft(
  value: number,
  format: (v: number) => string,
  onCommit: (v: number) => void,
  min: number,
  max: number,
) {
  // While the user types, show their draft; otherwise derive from the value in the same render,
  // so the field and the slider never disagree for a frame.
  const [draft, setDraft] = useState<string | null>(null);
  return {
    draft: draft ?? format(value),
    onChange: (raw: string): void => {
      setDraft(raw);
      const n = parseNumber(raw);
      if (raw.trim() !== "" && Number.isFinite(n) && n >= min && n <= max)
        onCommit(n);
    },
    onBlur: (): void => {
      if (draft === null) return;
      const n = parseNumber(draft);
      const next =
        draft.trim() !== "" && Number.isFinite(n)
          ? Math.min(max, Math.max(min, n))
          : value;
      onCommit(next);
      setDraft(null);
    },
  };
}

interface StarThresholdProps {
  /** Accessible name of the decimal field (e.g. "Nota mínima do produto"). */
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  disabled?: boolean;
}

/**
 * Minimum-rating filter: selectable stars for whole values plus a decimal field for precision.
 * It states a threshold ("4,5 estrelas ou mais"), never a rating given by the user.
 */
export function StarThreshold({
  label,
  value,
  onChange,
  min = 1,
  disabled = false,
}: StarThresholdProps) {
  const id = useId();
  const fmt = useCallback((v: number) => dec1(v), []);
  const num = useNumberDraft(
    value,
    fmt,
    (v) => onChange(Math.round(v * 10) / 10),
    min,
    5,
  );
  const pick = (n: number): void => {
    if (!disabled) onChange(Math.min(5, Math.max(min, n)));
  };
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${disabled ? "sa-is-off" : ""}`}
    >
      <div
        role="radiogroup"
        aria-label={`${label}: escolher em estrelas`}
        aria-disabled={disabled || undefined}
        className="sa-starpick"
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const checked = Math.floor(value) === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${n} ${n === 1 ? "estrela" : "estrelas"} ou mais`}
              aria-disabled={disabled || n < min || undefined}
              tabIndex={checked ? 0 : -1}
              className="sa-starpick-btn"
              onClick={() => pick(n)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                pick(Math.floor(value) + (e.key === "ArrowRight" ? 1 : -1));
                const group = e.currentTarget.parentElement;
                window.requestAnimationFrame(() =>
                  group
                    ?.querySelector<HTMLButtonElement>("[aria-checked=true]")
                    ?.focus(),
                );
              }}
            >
              <StarGlyph fill={value - (n - 1)} size={26} />
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sa-sr">
          {label}
        </label>
        <input
          id={id}
          className="sa-field sa-num text-center"
          style={{ width: 72 }}
          inputMode="decimal"
          value={num.draft}
          disabled={disabled}
          onChange={(e) => num.onChange(e.target.value)}
          onBlur={num.onBlur}
          aria-describedby={`${id}-v`}
        />
        <span id={`${id}-v`} className="sa-body-sm font-semibold">
          {dec1(value)} estrelas ou mais
        </span>
      </div>
    </div>
  );
}

interface RangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** Formats the value for display and for the slider's aria-valuetext. */
  format: (v: number) => string;
  /** Formats the min/max labels under the track (defaults to `format`). */
  formatEdge?: (v: number) => string;
  /** Unit shown next to the numeric field ("R$", "dias", "avaliações"). */
  unit: string;
  unitBefore?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** Id of a help/error text described by both inputs. */
  describedBy?: string;
}

/** Single-handle slider with a synced numeric field for precise values. */
export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  formatEdge = format,
  unit,
  unitBefore = false,
  disabled = false,
  invalid = false,
  describedBy,
}: RangeFieldProps) {
  const id = useId();
  const fmtInt = useCallback((v: number) => String(Math.round(v)), []);
  const num = useNumberDraft(
    value,
    fmtInt,
    (v) => onChange(Math.round(v)),
    min,
    max,
  );
  const clamped = Math.min(max, Math.max(min, value));
  const pct = ((clamped - min) / (max - min)) * 100;
  return (
    <div className={`grid gap-1 ${disabled ? "sa-is-off" : ""}`}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          className="sa-range min-w-0 flex-1"
          min={min}
          max={max}
          step={step}
          value={clamped}
          disabled={disabled}
          aria-label={`${label} (controle deslizante)`}
          aria-valuetext={format(clamped)}
          aria-describedby={describedBy}
          style={{ "--pct": `${pct}%` } as CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <div className="sa-numfield">
          {unitBefore ? (
            <span className="sa-caption sa-muted" aria-hidden="true">
              {unit}
            </span>
          ) : null}
          <label htmlFor={id} className="sa-sr">
            {label}
          </label>
          <input
            id={id}
            className="sa-field sa-num"
            inputMode="numeric"
            value={num.draft}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={(e) => num.onChange(e.target.value)}
            onBlur={num.onBlur}
          />
          {!unitBefore ? (
            <span className="sa-caption sa-muted" aria-hidden="true">
              {unit}
            </span>
          ) : null}
        </div>
      </div>
      <div
        className="flex justify-between sa-caption sa-muted sa-num"
        aria-hidden="true"
      >
        <span>{formatEdge(min)}</span>
        <span>{formatEdge(max)}</span>
      </div>
    </div>
  );
}

interface CompactRangeProps {
  /** Accessible name of the slider and the typed field. */
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** Text of the value button (e.g. "até R$ 580", "qualquer preço"). */
  display: ReactNode;
  /** Slider value text for screen readers. */
  valueText: string;
  /** Suffix after the value ("/peça", "/look"). */
  per?: string;
  /** Line under the bar with the range ("preço de R$ 100 a R$ 680 por peça"); omitted in tight bars. */
  caption?: string;
  className?: string;
}

/**
 * Compact slider with the value written beside it, the same pattern as the Estúdio budget
 * (CriterionQuick): drag the bar, or tap the dotted value to type an exact number.
 */
export function CompactRange({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  valueText,
  per,
  caption,
  className = "",
}: CompactRangeProps) {
  const fieldId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const clamped = Math.min(max, Math.max(min, value));
  const pct = ((clamped - min) / (max - min)) * 100;
  const commit = (): void => {
    const n = Number(draft.replace(/\D/g, ""));
    if (draft.trim() !== "" && Number.isFinite(n))
      onChange(Math.min(max, Math.max(min, Math.round(n / step) * step)));
    setEditing(false);
  };
  return (
    <div className={`grid gap-1 ${className}`}>
      <div className="sa-critbudget" role="group" aria-label={label}>
        <input
          type="range"
          className="sa-range sa-range-sm min-w-0 flex-1"
          min={min}
          max={max}
          step={step}
          value={clamped}
          aria-label={label}
          aria-valuetext={valueText}
          style={{ "--pct": `${pct}%` } as CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {/* Fixed-width slot: the value text changes length while dragging ("qualquer preço" vs
            "até R$ 1.330/peça"); without it the flex-1 slider resizes under the pointer. */}
        <span className="sa-critvalue-slot">
          {editing ? (
            <span className="sa-critvalue-edit">
              <label htmlFor={fieldId} className="sa-sr">
                {label} em reais
              </label>
              <span className="sa-caption sa-muted" aria-hidden="true">
                R$
              </span>
              <input
                ref={input}
                id={fieldId}
                className="sa-field sa-num"
                inputMode="numeric"
                value={draft}
                onChange={(e) =>
                  setDraft(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setEditing(false);
                  }
                }}
              />
              {per ? (
                <span className="sa-caption sa-muted" aria-hidden="true">
                  {per}
                </span>
              ) : null}
            </span>
          ) : (
            <button
              type="button"
              className="sa-critvalue sa-num"
              aria-label={`${label}: ${valueText}. Digitar valor`}
              onClick={() => {
                setDraft(String(Math.round(clamped)));
                setEditing(true);
              }}
            >
              {display}
              {per ? <span className="sa-muted">{per}</span> : null}
            </button>
          )}
        </span>
      </div>
      {caption ? <p className="sa-caption sa-muted">{caption}</p> : null}
    </div>
  );
}
