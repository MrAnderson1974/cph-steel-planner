'use strict';

const state = {
    queue: null,
    sha: null,
    dirty: false,
    actionCollapsed: false,
    autoSaveTimer: null
};

// ── INIT ──

async function init() {
    loadSettingsToForm();
    await loadData();
    render();
    setupKeyBindings();
    startAutoSave();
}

async function loadData() {
    const token = localStorage.getItem('gh_token');
    const repo  = localStorage.getItem('gh_repo');

    if (token && repo) {
        try {
            showStatus('Indlæser fra GitHub...');
            const result = await persistence.loadQueue(token, repo);
            state.queue = result.content;
            state.sha   = result.sha;
            showStatus('✓ Indlæst fra GitHub');
            return;
        } catch (e) {
            console.warn('GitHub load failed:', e);
            showStatus('GitHub fejl — bruger lokale data');
        }
    }

    const res = await fetch('data/queue.json');
    if (!res.ok) { showStatus('❌ Kunne ikke indlæse queue.json'); return; }
    state.queue = await res.json();
    showStatus('Lokale data indlæst');
}

// ── RENDER ──

function render() {
    if (!state.queue) return;
    renderKPI();
    renderActionRequired();
    renderBoard();
    setupDragDrop();
    updateDirtyFlag();
}

function updateDirtyFlag() {
    document.getElementById('dirty-flag').classList.toggle('hidden', !state.dirty);
}

function renderKPI() {
    const q = state.queue;
    const active = q.tilbud.filter(t => !t.is_sister);
    const totalTimer = active.reduce((s,t) => s + (t.beregnertid||0), 0);
    const ok    = active.filter(t => t.risk === '🟢').length;
    const stram = active.filter(t => t.risk === '🟡').length;
    const miss  = active.filter(t => t.risk === '🔴').length;

    document.getElementById('kpi-bar').innerHTML = `
        <div class="kpi-card">
            <div class="kpi-value">${active.length}</div>
            <div class="kpi-label">Tilbud</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-value">${formatNum(totalTimer, 0)}t</div>
            <div class="kpi-label">Total timer</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-value">${formatNum(q.config.capacity_per_day)}t</div>
            <div class="kpi-label">Kapacitet/dag</div>
        </div>
        <div class="kpi-card kpi-ok">
            <div class="kpi-value">${ok}</div>
            <div class="kpi-label">🟢 OK</div>
        </div>
        <div class="kpi-card kpi-tight">
            <div class="kpi-value">${stram}</div>
            <div class="kpi-label">🟡 Stramt</div>
        </div>
        <div class="kpi-card kpi-miss">
            <div class="kpi-value">${miss}</div>
            <div class="kpi-label">🔴 Misser</div>
        </div>`;
}

function renderActionRequired() {
    const q = state.queue;
    const today = todayStr();
    const items = [];

    for (const t of q.tilbud) {
        if (t.is_sister) continue;
        if (t.deadline && t.deadline < today) {
            items.push({ type: 'OVERSKREDET', t });
        } else if (t.risk === '🔴' && t.planned_end && t.deadline && t.planned_end > t.deadline) {
            items.push({ type: 'FOR SENT', t });
        } else if (t.bt_estimated) {
            items.push({ type: 'MANGLER BT', t });
        }
    }

    document.getElementById('action-count').textContent = items.length;

    if (items.length === 0) {
        document.getElementById('action-body').innerHTML =
            '<div class="action-empty">Ingen action items 👍</div>';
        return;
    }

    const html = items.map(({ type, t }) => {
        let cls = 'action-item';
        let label = '';
        if (type === 'OVERSKREDET') {
            cls += ' action-overdue';
            label = `🔴 OVERSKREDET — DL ${formatDateShort(t.deadline)} passeret`;
        } else if (type === 'FOR SENT') {
            cls += ' action-miss';
            label = `🔴 FOR SENT — DL ${formatDateShort(t.deadline)}, slut ${formatDateShort(t.planned_end)}`;
        } else {
            cls += ' action-bt';
            label = `⚠ MANGLER BT — estimeret @${formatNum(t.beregnertid)}t`;
        }
        return `<div class="${cls}">
            <span class="action-tnr">${escHtml(t.tilbudsnr)}</span>
            <span class="action-name">${escHtml(t.projekt || t.tilbudsnavn)}</span>
            <span class="action-label">${label}</span>
        </div>`;
    }).join('');

    const body = document.getElementById('action-body');
    body.innerHTML = html;
    body.classList.toggle('hidden', state.actionCollapsed);
}

function renderBoard() {
    const q = state.queue;
    const today = todayStr();
    const endDate = addDays(today, (q.config.planning_weeks || 6) * 7 + 14);
    const allDays = getWorkingDaysInRange(today, endDate, q.config.holidays);
    const weekMap = groupByWeek(allDays);
    const tilbudMap = Object.fromEntries(q.tilbud.map(t => [t.tilbudsnr, t]));

    let html = '';

    for (const [week, days] of weekMap) {
        const weekTilbud = new Set();
        let weekUsed = 0, weekCap = 0;

        for (const d of days) {
            const info = q.day_capacity[d] || { used: 0, capacity: q.config.capacity_per_day };
            weekUsed += info.used;
            weekCap  += info.capacity;
            (q.schedule[d] || []).forEach(i => { if (!i.is_sister_display) weekTilbud.add(i.tilbudsnr); });
        }

        const pct = weekCap > 0 ? Math.round(weekUsed / weekCap * 100) : 0;

        html += `<div class="week-section">
            <div class="week-header">📅 UGE ${week} &mdash; ${weekTilbud.size} tilbud &mdash; ${formatNum(weekUsed, 0)}t/${formatNum(weekCap, 0)}t (${pct}%)</div>
            <div class="week-days">`;

        for (const date of days) {
            const items = q.schedule[date] || [];
            const info  = q.day_capacity[date] || { used: 0, capacity: q.config.capacity_per_day };
            const pctDay = info.capacity > 0 ? Math.min(1, info.used / info.capacity) : 0;
            const barCls = pctDay >= 1 ? 'full' : pctDay >= 0.85 ? 'tight' : '';
            const isToday = date === today;
            const holName = q.config.holidays[date];

            html += `<div class="day-column${isToday ? ' day-today' : ''}">
                <div class="day-header">
                    <span class="day-name">${formatDateLong(date)}${holName ? ` — ${holName}` : ''}</span>
                    <span class="day-capacity">${formatNum(info.used)}t / ${formatNum(info.capacity)}t</span>
                    ${pctDay >= 1 ? '<span class="capacity-full">FULD</span>' : ''}
                </div>
                <div class="cap-bar"><div class="cap-bar-fill ${barCls}" style="width:${Math.round(pctDay*100)}%"></div></div>
                <div class="day-drop-zone" data-date="${date}">`;

            // Render non-sister cards; collect sisters for each master
            for (const item of items) {
                if (item.is_sister_display) continue;
                const t = tilbudMap[item.tilbudsnr];
                if (!t) continue;

                const sistersHere = items
                    .filter(i => i.is_sister_display && (t.sisters||[]).includes(i.tilbudsnr))
                    .map(i => tilbudMap[i.tilbudsnr]).filter(Boolean);

                html += renderCard(t, item.hours, date, sistersHere);
            }

            // Orphan sister display cards (when master is on a different day)
            for (const item of items) {
                if (!item.is_sister_display) continue;
                const t = tilbudMap[item.tilbudsnr];
                if (!t) continue;
                // Check if master is also on this day
                const masterTnr = t.master_nr;
                const masterOnDay = masterTnr && items.some(i => i.tilbudsnr === masterTnr && !i.is_sister_display);
                if (!masterOnDay) {
                    html += renderSisterCard(t);
                }
            }

            html += `</div></div>`; // drop-zone + day-column
        }

        html += `</div></div>`; // week-days + week-section
    }

    document.getElementById('board').innerHTML = html ||
        '<div class="no-schedule">Ingen tilbud planlagt i denne periode.</div>';
}

function getRiskClass(risk) {
    if (risk === '🟢') return 'risk-ok';
    if (risk === '🟡') return 'risk-tight';
    if (risk === '🔴') return 'risk-miss';
    return 'risk-none';
}

function renderCard(t, hoursToday, date, sistersHere) {
    const today = todayStr();
    const isOverdue = t.deadline && t.deadline < today;
    const gradeClass = { A:'grade-a', B:'grade-b', C:'grade-c' }[t.kunde_grade] || 'grade-unknown';

    let marginText = '—';
    if (t.planned_end && t.deadline) {
        if (t.planned_end > t.deadline) {
            marginText = `${Math.abs(daysBetween(t.deadline, t.planned_end))}d OVER`;
        } else {
            const m = daysBetween(t.planned_end, t.deadline);
            marginText = `${m}d margin`;
        }
    }

    const beskr = t.beskrivelse
        ? escHtml(t.beskrivelse.length > 110 ? t.beskrivelse.substring(0,110)+'…' : t.beskrivelse)
        : '';

    const sistersHtml = sistersHere && sistersHere.length > 0
        ? `<div class="sister-block">💜 Søstre: ${sistersHere.map(s =>
            `<span class="sister-tag">${escHtml(s.tilbudsnr)} (${escHtml(s.kundenavn.split(' ')[0])})</span>`
          ).join(' ')}</div>`
        : '';

    const btEditHtml = t.bt_estimated
        ? `<div class="card-edit-bt">BT: <input class="bt-input" type="number" value="${t.beregnertid}" step="0.5" min="0"
            onchange="onBTChange('${t.tilbudsnr}', this.value)" onclick="event.stopPropagation()">t
            <span class="bt-estimated-badge">(estimeret)</span></div>`
        : '';

    return `<div class="card${t.bt_estimated ? ' card-estimated' : ''}${isOverdue ? ' card-overdue' : ''}"
        draggable="true" data-tnr="${escHtml(t.tilbudsnr)}" data-date="${date}">
        <div class="card-header${isOverdue ? ' header-overdue' : ''}">
            <span class="card-tnr">${escHtml(t.tilbudsnr)}</span>
            <span class="card-hours">${formatNum(hoursToday)}t</span>
            <span class="card-kunde">${escHtml(t.kundenavn)}</span>
            ${t.deadline ? `<span class="card-dl">DL ${formatDateShort(t.deadline)}</span>` : ''}
        </div>
        <div class="card-body">
            <div class="card-projekt">${escHtml(t.projekt || t.tilbudsnavn)}</div>
            ${beskr ? `<div class="card-beskr">${beskr}</div>` : ''}
        </div>
        <div class="card-kpis">
            <span class="kpi-tile ${getRiskClass(t.risk)}">${t.risk} ${marginText}</span>
            <span class="kpi-tile ${gradeClass}">Grade ${t.kunde_grade || '?'}</span>
            ${t.must_win ? '<span class="kpi-tile kpi-mw">MW</span>' : ''}
            ${t.high_ref ? '<span class="kpi-tile kpi-href">⭐ REF</span>' : ''}
            <span class="kpi-tile">🔩${t.steel_scope || '?'}</span>
            <span class="kpi-tile">${formatNum(t.beregnertid)}t tot${t.bt_estimated ? ' ~' : ''}</span>
        </div>
        ${sistersHtml}${btEditHtml}
    </div>`;
}

function renderSisterCard(t) {
    const master = state.queue.tilbud.find(x => x.tilbudsnr === t.master_nr);
    return `<div class="card-sister">
        <span class="sister-tnr">${escHtml(t.tilbudsnr)}</span>
        <span class="sister-info">${escHtml(t.kundenavn)} — Søster af ${escHtml(t.master_nr || '?')}</span>
    </div>`;
}

// ── EVENT HANDLERS ──

function onBTChange(tilbudsNr, newVal) {
    const bt = parseFloat(String(newVal).replace(',', '.'));
    if (isNaN(bt) || bt < 0) return;
    updateBeregnertid(state.queue, tilbudsNr, bt);
    state.dirty = true;
    render();
}

function toggleActionRequired() {
    state.actionCollapsed = !state.actionCollapsed;
    document.getElementById('action-body').classList.toggle('hidden', state.actionCollapsed);
    document.getElementById('action-toggle').textContent = state.actionCollapsed ? '▶' : '▼';
}

function toggleSettings() {
    document.getElementById('settings-panel').classList.toggle('hidden');
}

function loadSettingsToForm() {
    document.getElementById('s-token').value    = localStorage.getItem('gh_token') || '';
    document.getElementById('s-repo').value     = localStorage.getItem('gh_repo') || '';
    document.getElementById('s-capacity').value = localStorage.getItem('gh_capacity') || '7.4';
}

function saveSettings() {
    const token    = document.getElementById('s-token').value.trim();
    const repo     = document.getElementById('s-repo').value.trim();
    const capacity = parseFloat(document.getElementById('s-capacity').value) || 7.4;

    if (token)    localStorage.setItem('gh_token', token);
    if (repo)     localStorage.setItem('gh_repo', repo);
    localStorage.setItem('gh_capacity', String(capacity));

    if (state.queue) state.queue.config.capacity_per_day = capacity;
    toggleSettings();
    showStatus('Indstillinger gemt');
}

async function forceSave() {
    const token = localStorage.getItem('gh_token');
    const repo  = localStorage.getItem('gh_repo');

    if (!token || !repo) {
        alert('Konfigurer GitHub token og repo i Indstillinger først.');
        toggleSettings();
        return;
    }

    try {
        showStatus('Gemmer til GitHub...');
        const newSha = await persistence.saveQueue(token, repo, state.queue, state.sha);
        state.sha   = newSha;
        state.dirty = false;
        updateDirtyFlag();
        showStatus('✓ Gemt til GitHub');
    } catch (e) {
        if (e.message === 'CONFLICT') {
            showStatus('⚠ Konflikt — reload siden for at synkronisere');
        } else {
            showStatus(`❌ Gem fejlede: ${e.message}`);
        }
    }
}

function startAutoSave() {
    if (state.autoSaveTimer) clearInterval(state.autoSaveTimer);
    state.autoSaveTimer = setInterval(async () => {
        if (state.dirty && localStorage.getItem('gh_token') && localStorage.getItem('gh_repo')) {
            await forceSave();
        }
    }, 30000);
}

function setupKeyBindings() {
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key === 's') { e.preventDefault(); forceSave(); }
        if (e.ctrlKey && e.key === 'e') { e.preventDefault(); exportExcel(); }
        if (e.key === 'Escape') {
            document.getElementById('settings-panel').classList.add('hidden');
        }
    });
}

function showStatus(msg) {
    const el = document.getElementById('save-status');
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; }, 5000);
}

window.addEventListener('DOMContentLoaded', init);
