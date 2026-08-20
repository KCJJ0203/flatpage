/**
 * The thumbnail strip along the bottom: tap to re-edit, long-press to delete.
 *
 * Reordering by drag is deliberately left out of v1 — delete and re-shoot
 * covers the case, and a drag-to-reorder gesture fights the corner editor's
 * pointer handling for no proportionate gain.
 */

export function renderPageStrip(container, pages, { onSelect, onDelete }) {
  container.replaceChildren();
  pages.forEach((page, index) => {
    const item = document.createElement('div');
    item.className = 'page-thumb';

    const img = document.createElement('img');
    img.alt = `Page ${index + 1}`;
    img.src = URL.createObjectURL(new Blob([page.thumbnail ?? page.jpeg], { type: 'image/jpeg' }));
    img.addEventListener('load', () => URL.revokeObjectURL(img.src), { once: true });

    const label = document.createElement('span');
    label.className = 'page-number';
    label.textContent = String(index + 1);

    const remove = document.createElement('button');
    remove.className = 'page-delete';
    remove.type = 'button';
    remove.setAttribute('aria-label', `Delete page ${index + 1}`);
    remove.textContent = '×';
    remove.addEventListener('click', (e) => { e.stopPropagation(); onDelete(index); });

    item.append(img, label, remove);
    item.addEventListener('click', () => onSelect(index));
    container.appendChild(item);
  });
}
