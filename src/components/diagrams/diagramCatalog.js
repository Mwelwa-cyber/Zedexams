/**
 * Re-export only. The catalogue lives in the shared assessment package.
 *
 * @see functions/shared/assessment/diagramCatalogCore.js
 *
 * It moved because the export gate's figure check is only meaningful against
 * the catalogue the EXPORTER will actually draw from. A "server-compatible"
 * second catalogue would answer a different question — whether some other
 * drawing function can render the key — and the first shape that existed in one
 * and not the other would make the server refuse a paper the studio blessed, or
 * bless one the studio refuses. It is 443 lines of pure SVG-string generation
 * with no imports, so there was never anything browser-specific about it.
 *
 * DO NOT ADD A SHAPE HERE.
 */
export * from '../../../functions/shared/assessment/diagramCatalogCore.js'
