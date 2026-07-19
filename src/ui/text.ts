import { truncateToWidth } from "@earendil-works/pi-tui";

// Terminal string sequences must be removed before theme styling is applied.
const OSC_SEQUENCE = /(?:\u001b\]|\u009d)[\s\S]*?(?:\u0007|\u001b\\|\u009c)/gu;
const ST_SEQUENCE =
  /(?:\u001b[PX^_]|[\u0090\u0098\u009e\u009f])[\s\S]*?(?:\u001b\\|\u009c)/gu;
const CSI_SEQUENCE = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/gu;
const ESC_SEQUENCE = /\u001b[@-_]/gu;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/gu;

/** Convert untrusted journal content to one printable terminal line. */
export function sanitizeDisplayText(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(OSC_SEQUENCE, " ")
    .replace(ST_SEQUENCE, " ")
    .replace(CSI_SEQUENCE, " ")
    .replace(ESC_SEQUENCE, " ")
    .replace(CONTROL_CHARACTER, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Fit an already-styled line to a component's visible-width contract. */
export function fitRow(value: string, width: number, pad = false): string {
  return truncateToWidth(value, Math.max(0, width), "…", pad);
}
