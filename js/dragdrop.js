'use strict';

const dragState = { tilbudsNr: null, sourceDate: null };

function setupDragDrop() {
    document.querySelectorAll('.card[draggable="true"]').forEach(card => {
        card.addEventListener('dragstart', onDragStart);
        card.addEventListener('dragend', onDragEnd);
    });

    document.querySelectorAll('.day-drop-zone').forEach(zone => {
        zone.addEventListener('dragover', onDragOver);
        zone.addEventListener('dragleave', onDragLeave);
        zone.addEventListener('drop', onDrop);
    });
}

function onDragStart(e) {
    dragState.tilbudsNr = e.currentTarget.dataset.tnr;
    dragState.sourceDate = e.currentTarget.dataset.date;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragState.tilbudsNr);
}

function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.day-drop-zone.drag-over').forEach(z => z.classList.remove('drag-over'));
    dragState.tilbudsNr = null;
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
    const tilbudsNr = dragState.tilbudsNr;

    if (!tilbudsNr || !targetDate) return;
    if (dragState.sourceDate === targetDate) return;

    moveCard(state.queue, tilbudsNr, targetDate);
    state.dirty = true;
    render();
}
