import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANNOTATION_DRAFT_MARKER,
  stripAnnotationDraftMarker,
  reconcileAnnotationDraft,
} from '../packages/reader/src/reader-state.mjs';

test('annotation draft marker admits an empty visible prompt without leaking into text', () => {
  assert.equal(ANNOTATION_DRAFT_MARKER.trim(), ANNOTATION_DRAFT_MARKER);
  assert.equal(stripAnnotationDraftMarker(ANNOTATION_DRAFT_MARKER), '');
  assert.equal(stripAnnotationDraftMarker(`${ANNOTATION_DRAFT_MARKER}  explain this  `), 'explain this');
  assert.equal(stripAnnotationDraftMarker('ordinary text'), 'ordinary text');
});

test('annotation marker is restored reactively and removed when notes are gone', () => {
  assert.equal(reconcileAnnotationDraft({ annotations: 1, draft: '', phase: 'plain' }), ANNOTATION_DRAFT_MARKER);
  assert.equal(reconcileAnnotationDraft({ annotations: 1, draft: ANNOTATION_DRAFT_MARKER, phase: 'plain' }), null);
  assert.equal(reconcileAnnotationDraft({ annotations: 1, draft: '', phase: 'submitting' }), null);
  assert.equal(reconcileAnnotationDraft({ annotations: 0, draft: ANNOTATION_DRAFT_MARKER, phase: 'plain' }), '');
  assert.equal(reconcileAnnotationDraft({ annotations: 0, draft: 'typed', phase: 'plain' }), null);
});

test('current page follows the reading anchor through pages and gaps', () => {
  const pages = [
    { page: 1, top: 20, bottom: 620 },
    { page: 2, top: 650, bottom: 1250 },
    { page: 3, top: 1280, bottom: 1880 },
  ];
});
