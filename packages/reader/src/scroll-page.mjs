export function scrollToPage(container, page) {
  const target = container?.querySelector(`[data-amadeus-page="${page}"]`);
  if (!target) return;
  const padding = parseFloat(getComputedStyle(container).paddingTop) || 0;
  const top = container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop - padding;
  container.scrollTo({ top, behavior: 'instant' });
}
