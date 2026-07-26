/**
 * Normalize Kenyan mobile numbers to 254XXXXXXXXX.
 * Accepts 07XX…, 01XX…, +2547XX…, 2547XX…, 7XX…, and spaced/dashed variants.
 * Returns null when the input can't be a Kenyan mobile number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/[^\d]/g, '')
  if (!digits) return null

  let local: string
  if (digits.startsWith('254')) local = digits.slice(3)
  else if (digits.startsWith('0')) local = digits.slice(1)
  else local = digits

  // Kenyan mobile prefixes are 7XXXXXXXX or 1XXXXXXXX (9 digits after the 0/254).
  if (!/^[71]\d{8}$/.test(local)) return null
  return `254${local}`
}

/** 0712 345 678 — friendlier to read than the wire format. */
export function displayPhone(normalized: string): string {
  if (!/^254\d{9}$/.test(normalized)) return normalized
  const local = `0${normalized.slice(3)}`
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`
}

export function waLink(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
}
