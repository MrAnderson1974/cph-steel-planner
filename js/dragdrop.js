'use strict';

const dragState = { tilbudsNr: null, sourceDate: null };

function setupDragDrop() {
    // Drag handlers are wired inline in renderCard / renderBoard via ondragstart etc.
}

function onDragStart(e) {
    dragState.tilbudsNr  = e.currentTarget.dataset.tnr;
    dragState.sourceDate = e.currentTarget.dataset.date;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragState.tilbudsNr);

    // Add drop hints to empty zones
    document.querySelectorAll('.day-drop-zone').forEach(z => {
        const cards = z.querySelectorAll('.card, .card-sister');
        if (cards.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'drop-hint-el';
            hint.textContent = '↓ Slip her';
            z.appendChild(hint);
        }
    });
}

function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.day-drop-zone.drag-over').forEach(z => z.classList.remove('drag-over'));
    document.querySelectorAll('.drop-hint-el').forEach(el => el.remove());
    dragState.tilbudsNr  = null;
    dragState.sourceDate = null;
}

function onDragOver(e) {
    if (!dragState.tilbudsNr) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
}

function onDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
        e.currentTarget.classList.remove('drag-over');
    }
}

function onDrop(e) {
    e.preventDefault();
    const zone = e.currentTarget;
    zone.classList.remove('drag-over');

    const targetDate = zone.dataset.date;
    const tilbudsNr  = dragState.tilbudsNr;

    if (!tilbudsNr || !targetDate) return;
    if (dragState.sourceDate === targetDate) return;

    pushUndo(`Flyt ${tilbudsNr}`);
    // Flex drag: always allow up to 2× cap per day so days are never hard-blocked
    const flexMax = state.queue.config.capacity_per_day * 2;
    moveCard(state.queue, tilbudsNr, targetDate, flexMax);
    state.dirty = true;
    render();
}
