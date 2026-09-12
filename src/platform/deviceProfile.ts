/**
 * iPadOS identifies itself as macOS in some browsers. Touch points distinguish
 * those devices without reducing quality for actual Macs.
 */
export const usesIPadPerformanceProfile = (): boolean => {
  if (typeof navigator === 'undefined') return false
  return navigator.userAgent.includes('iPad') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
