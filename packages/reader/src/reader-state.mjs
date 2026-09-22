// DSH 0.1.6 treats a textless, attachmentless composer as non-submittable.
// This marker is invisible but is not removed by String#trim, so annotation-only
// requests can travel through the native composer without replacing its UI.
export const ANNOTATION_DRAFT_MARKER = '\u200b';

export function stripAnnotationDraftMarker(text) {
  if (!text.startsWith(ANNOTATION_DRAFT_MARKER)) return text;
  return text.slice(ANNOTATION_DRAFT_MARKER.length).trim();
}

export function reconcileAnnotationDraft({ annotations, draft, phase }) {
  if (phase !== 'plain') return null;
  if (annotations > 0 && draft === '') return ANNOTATION_DRAFT_MARKER;
  if (annotations === 0 && draft === ANNOTATION_DRAFT_MARKER) return '';
  return null;
}
