/**
 * Utility for detecting Right-to-Left (RTL) text content.
 */
export function detectIsRTL(text: string): boolean {
    if (!text) return false;
    // Unicode ranges for RTL scripts (Hebrew, Arabic, Persian, Urdu, Syriac, Thaana, etc.)
    const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u0800-\u083F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
    const ltrRegex = /[a-zA-Z]/g;
    const rtlMatches = text.match(rtlRegex) || [];
    const ltrMatches = text.match(ltrRegex) || [];
    return rtlMatches.length > 0 && rtlMatches.length >= ltrMatches.length;
}
