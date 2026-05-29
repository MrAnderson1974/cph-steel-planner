'use strict';

const state = {
    queue: null,
    sha: null,
    dirty: false,
    actionCollapsed: false,
    autoSaveTimer: null,
    filter: 'all',
    sidebarCollapsed: false
};

const undoStack = [];
const MAX_UNDO = 20;

// ── INIT ──

async function init() {
    loadSettingsToForm();
    await loadData();
    render();
    setupKeyBindings();
    startAutoSave();
    checkOnboarding();
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
            refreshRisk();
            showStatus('✓ GitHub');
            showPipelineTimestamp();
            return;
        } catch (e) {
            console.warn('GitHub load failed:', e);
            showStatus('GitHub fejl — bruger lokale data');
        }
    }

    const res = await fetch('data/queue.json');
    if (!res.ok) { showStatus('❌ Kunne ikke indlæse queue.json'); return; }
    // Brug .text() + JSON.parse så browseren altid tolker som UTF-8 (GitHub Pages sætter ikke charset)
    const raw = await res.text();
    state.queue = JSON.parse(raw);
    refreshRisk();
    showStatus('✓ Lokale data');
    showPipelineTimestamp();
}

function refreshRisk() {
    // Genberegn risk live fra planned_end vs deadline — aldrig stolt på gemt felt
    if (!state.queue) return;
    for (const t of state.queue.tilbud) {
        t.risk = calculateRisk(t);
    }
}

function showPipelineTimestamp() {
    const gen = state.queue && state.queue.meta && state.queue.meta.generated;
    if (!gen) return;
    const el = document.getElementById('pipeline-ts');
    if (el) el.textContent = `Pipeline: ${gen}`;
}

// ── UNDO ──

function pushUndo(label) {
    undoStack.push({ label, snapshot: JSON.parse(JSON.stringify(state.queue)) });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    updateUndoBtn();
}

function undoLast() {
    if (!undoStack.length) return;
    const { label, snapshot } = undoStack.pop();
    state.queue = snapshot;
    state.dirty = true;
    updateUndoBtn();
    render();
    showToast(`↩ Fortryd: ${label}`);
}

function updateUndoBtn() {
    const btn = document.getElementById('btn-undo');
    btn.disabled = undoStack.length === 0;
    btn.textContent = undoStack.length > 0 ? `↩ Fortryd (${undoStack.length})` : '↩ Fortryd';
}

// ── SIDEBAR ──

function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    document.getElementById('sidebar').classList.toggle('collapsed', state.sidebarCollapsed);
}

// ── FILTERS ──

function setFilter(f) {
    state.filter = f;
    document.querySelectorAll('.filter-btn').forEach(el => {
        el.classList.toggle('active', el.id === `f-${f}`);
    });
    render();
}

function getFilteredSet(q) {
    if (state.filter === 'all') return null;
    const active = q.tilbud.filter(t => !t.is_sister && !t._removed_from_pipeline);
    let filtered;
    switch (state.filter) {
        case 'miss':    filtered = active.filter(t => t.risk === '🔴'); break;
        case 'tight':   filtered = active.filter(t => t.risk === '🟡'); break;
        case 'nobt':    filtered = active.filter(t => t.bt_estimated); break;
        case 'grade-a': filtered = active.filter(t => (t.kunde_grade || t.rating) === 'A'); break;
        case 'mw':      filtered = active.filter(t => t.must_win); break;
        default:        filtered = active;
    }
    return new Set(filtered.map(t => t.tilbudsnr));
}

// ── AUTOMATIONER ──

function runReOptimer() {
    if (!state.queue) return;
    pushUndo('Re-optimer rækkefølge');
    reOptimer(state.queue);
    state.dirty = true;
    render();
    showToast('Re-optimer kørt — plan genrangeret efter prioritet');
}

function runPakSchedule() {
    if (!state.queue) return;
    pushUndo('Pak schedule');
    pakSchedule(state.queue);
    state.dirty = true;
    render();
    showToast('Schedule pakket — huller lukket fra i dag');
}

// ── HELP ──

function toggleHelp() {
    document.getElementById('help-panel').classList.toggle('hidden');
}

// ── ONBOARDING ──

function checkOnboarding() {
    if (!localStorage.getItem('cph_onboarded')) {
        document.getElementById('onboarding-overlay').classList.remove('hidden');
    }
}

function obNext(step) {
    document.querySelectorAll('.ob-step').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.ob-dot').forEach(el => el.classList.remove('active'));
    document.getElementById(`ob-${step}`).classList.remove('hidden');
    document.getElementById(`dot-${step}`).classList.add('active');
}

function closeOnboarding() {
    localStorage.setItem('cph_onboarded', '1');
    document.getElementById('onboarding-overlay').classList.add('hidden');
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
    const active = q.tilbud.filter(t => !t.is_sister && !t._removed_from_pipeline);
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
    const overdue = [], miss = [], nobt = [], jaDecision = [], pipelineFixed = [];

    for (const t of q.tilbud) {
        if (t.is_sister) continue;
        if (t._removed_from_pipeline) continue;
        if (t.deadline && t.deadline < today) {
            overdue.push(t);
        } else if (t.planned_end && t.deadline && t.planned_end > t.deadline) {
            miss.push(t);
        } else {
            if (t.bt_estimated) {
                const firstDay = t.scheduled_days && t.scheduled_days.length > 0 ? t.scheduled_days[0] : t.deadline;
                const daysAway = firstDay ? daysBetween(today, firstDay) : 999;
                if (daysAway <= 14) nobt.push(t);
            }
            if (t._ja_decision) jaDecision.push(t);
            if (t._pipeline_overridden) pipelineFixed.push(t);
        }
    }

    const total = overdue.length + miss.length + nobt.length + jaDecision.length + pipelineFixed.length;
    document.getElementById('action-count').textContent = total;

    function groupRows(items, detailFn, urgent = false) {
        if (items.length === 0) return '<div class="ag-empty">Ingen</div>';
        return items.map(t => `
            <div class="ag-row${urgent ? ' ag-row--urgent' : ''}">
                <span class="ag-tnr">${escHtml(t.tilbudsnr)}</span>
                <span class="ag-name" title="${escHtml(t.projekt || t.tilbudsnavn)}">${escHtml((t.projekt || t.tilbudsnavn).substring(0, 26))}</span>
                <span class="ag-detail">${detailFn(t)}</span>
            </div>`).join('');
    }

    const html = `
        <div class="action-group action-group--overdue">
            <div class="ag-header">
                <span class="ag-title">⛔ Deadline overskredet</span>
                <span class="ag-count">${overdue.length}</span>
            </div>
            ${groupRows(overdue, t => `DL ${formatDateShort(t.deadline)} passeret`, true)}
        </div>
        <div class="action-group action-group--miss">
            <div class="ag-header">
                <span class="ag-title">🔴 Misser deadline</span>
                <span class="ag-count">${miss.length}</span>
            </div>
            ${groupRows(miss, t => {
                const over = daysBetween(t.deadline, t.planned_end);
                return `DL ${formatDateShort(t.deadline)} — slut ${formatDateShort(t.planned_end)} (+${over}d)`;
            }, true)}
        </div>
        <div class="action-group action-group--bt">
            <div class="ag-header">
                <span class="ag-title">Mangler BT · starter &lt;14d</span>
                <span class="ag-count">${nobt.length}</span>
            </div>
            ${groupRows(nobt, t => `~${formatNum(t.beregnertid)}t estimeret`)}
        </div>
        <div class="action-group action-group--ja">
            <div class="ag-header">
                <span class="ag-title">⚡ JA beslutning</span>
                <span class="ag-count">${jaDecision.length}</span>
            </div>
            ${groupRows(jaDecision, t => {
                const j = t._ja_decision;
                return `Tom: ${formatDateShort(j.tracker_end)} · Excel: ${formatDateShort(j.excel_finish)} (${j.days_saved}d bedre)`;
            })}
        </div>
        <div class="action-group action-group--fixed">
            <div class="ag-header">
                <span class="ag-title">🔧 Justeret af pipeline</span>
                <span class="ag-count">${pipelineFixed.length}</span>
            </div>
            ${groupRows(pipelineFixed, t => {
                const p = t._pipeline_overridden;
                return `${formatDateShort(p.old_planned_end)} → ${formatDateShort(p.new_planned_end)}`;
            })}
        </div>`;

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
    const filterSet = getFilteredSet(q);

    let html = '';

    for (const [week, days] of weekMap) {
        const weekTilbud = new Set();
        let weekUsed = 0, weekCap = 0;
        let weekHasContent = false;

        for (const d of days) {
            const schedItems  = q.schedule[d] || [];
            const usedCalc    = schedItems.filter(i => i.tilbudsnr !== '__admin__').reduce((s, i) => s + (i.hours || 0), 0);
            const storedDay   = q.day_capacity[d];
            const info        = storedDay
                ? { used: Math.max(storedDay.used, usedCalc), capacity: storedDay.capacity || q.config.capacity_per_day }
                : { used: usedCalc, capacity: q.config.capacity_per_day };
            weekUsed += info.used;
            weekCap  += info.capacity;
            const items = schedItems;
            items.forEach(i => {
                if (!i.is_sister_display) {
                    if (!filterSet || filterSet.has(i.tilbudsnr)) {
                        weekTilbud.add(i.tilbudsnr);
                        weekHasContent = true;
                    }
                }
            });
        }

        if (filterSet && !weekHasContent) continue;

        const normWeekCap = days.length * q.config.capacity_per_day; // 37t for full week
        const weekOT = Math.max(0, weekUsed - normWeekCap);
        const weekOTHtml = weekOT > 0.05
            ? ` &mdash; <span class="week-ot">+${formatNum(weekOT, 1)}t OT</span>`
            : '';

        html += `<div class="week-section">
            <div class="week-header">📅 UGE ${week} &mdash; ${weekTilbud.size} tilbud &mdash; ${formatNum(weekUsed, 1)}t${weekOTHtml}</div>
            <div class="week-days">`;

        for (const date of days) {
            const items = q.schedule[date] || [];
            const usedFromItems = items.filter(i => i.tilbudsnr !== '__admin__').reduce((s, i) => s + (i.hours || 0), 0);
            const storedInfo    = q.day_capacity[date];
            const info          = storedInfo
                ? { used: Math.max(storedInfo.used, usedFromItems), capacity: storedInfo.capacity || q.config.capacity_per_day }
                : { used: usedFromItems, capacity: q.config.capacity_per_day };
            const normCap = q.config.capacity_per_day;
            const otHours = Math.max(0, info.used - normCap);
            const pctDay  = normCap > 0 ? Math.min(1, info.used / normCap) : 0;
            const barCls  = otHours > 0.05 ? 'ot' : (pctDay >= 1 ? 'full' : pctDay >= 0.85 ? 'tight' : '');
            const isToday = date === today;
            const holName = q.config.holidays[date];

            const otHtml = otHours > 0.05
                ? `<span class="day-ot">+${formatNum(otHours, 1)}t OT</span>`
                : '';

            const visibleItems = items.filter(i => {
                if (i.is_sister_display) return false;
                return !filterSet || filterSet.has(i.tilbudsnr);
            });
            if (filterSet && visibleItems.length === 0) continue;

            html += `<div class="day-column${isToday ? ' day-today' : ''}">
                <div class="day-header">
                    <span class="day-name">${formatDateLong(date)}${holName ? ` — ${holName}` : ''}</span>
                    <span class="day-capacity">${formatNum(info.used, 1)}t${otHtml}</span>
                </div>
                <div class="cap-bar"><div class="cap-bar-fill ${barCls}" style="width:${Math.round(pctDay*100)}%"></div></div>
                <div class="day-drop-zone" data-date="${date}"
                    ondragover="onDragOver(event)"
                    ondragleave="onDragLeave(event)"
                    ondrop="onDrop(event)">`;

            for (const item of items) {
                if (item.is_sister_display) continue;
                if (filterSet && !filterSet.has(item.tilbudsnr)) continue;
                const t = tilbudMap[item.tilbudsnr];
                if (!t) continue;

                // Vis ALLE søstre — opslag direkte i tilbudsliste
                const allSisters = t.is_master
                    ? q.tilbud.filter(s => s.is_sister && s.master_nr === t.tilbudsnr)
                    : [];

                html += renderCard(t, item.hours, date, allSisters);
            }

            // Orphan sister display cards
            if (!filterSet) {
                for (const item of items) {
                    if (!item.is_sister_display) continue;
                    const t = tilbudMap[item.tilbudsnr];
                    if (!t) continue;
                    const masterTnr = t.master_nr;
                    const masterOnDay = masterTnr && items.some(i => i.tilbudsnr === masterTnr && !i.is_sister_display);
                    if (!masterOnDay) html += renderSisterCard(t);
                }
            }

            html += `</div></div>`;
        }

        html += `</div></div>`;
    }

    document.getElementById('board').innerHTML = html ||
        '<div class="no-schedule">Ingen tilbud matcher det valgte filter.</div>';
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
    // Fallback: pipeline bruger 'rating', tracker bruger 'kunde_grade'
    const grade = t.kunde_grade || (t.rating !== 'Ny' ? t.rating : null);
    const gradeClass   = { A:'grade-a', B:'grade-b', C:'grade-c' }[grade] || 'grade-unknown';
    const gradeIcon    = { A:'★', B:'◆', C:'○' }[grade] || '?';
    const riskBorder   = { '🟢':'card-ok', '🟡':'card-tight', '🔴':'card-miss', '⚪':'card-none' }[t.risk] || '';

    let marginText = '—';
    let marginShort = '';
    if (t.planned_end && t.deadline) {
        if (t.planned_end > t.deadline) {
            const d = Math.abs(daysBetween(t.deadline, t.planned_end));
            marginText = `${d}d OVER`;
            marginShort = `${d}d OVER`;
        } else {
            const d = daysBetween(t.planned_end, t.deadline);
            marginText = `${d}d margin`;
            marginShort = `+${d}d`;
        }
    }

    // Projektbeskrivelse: steel_desc + resume + kontekstfelter
    const steelDesc = t.steel_desc ? `<div class="beskr-steel">${escHtml(t.steel_desc)}</div>` : '';
    const resumeTxt = t.resume    ? `<div class="beskr-resume">${escHtml(t.resume)}</div>`    : '';

    const meta = [];
    if (t.lokation && t.lokation !== 'Ikke oplyst') meta.push(`📍 ${t.lokation}`);
    if (t.entreprise && t.entreprise !== t.entreprise_form) meta.push(`🏗 ${t.entreprise}`);
    else if (t.entreprise_form) meta.push(`🏗 ${t.entreprise_form}`);
    if (t.startdato && t.slutdato) {
        const fmt = d => { const p = d.split('-'); return `${p[2]}/${p[1]}-${p[0].slice(2)}`; };
        meta.push(`📅 ${fmt(t.startdato)} → ${fmt(t.slutdato)}`);
    }
    const metaHtml = meta.length ? `<div class="beskr-meta">${meta.map(escHtml).join(' · ')}</div>` : '';

    const beskr = (steelDesc || resumeTxt || metaHtml)
        ? steelDesc + resumeTxt + metaHtml
        : (t.beskrivelse ? `<div class="beskr-resume">${escHtml(t.beskrivelse.substring(0,200))}</div>` : '');

    // RFI-sektion
    const rfiIcons  = { UL:'🔩', UE:'🏗', INFO:'📋', JURIDISK:'⚖', TEKNISK:'🔧' };
    const rfiColors = { UL:'rfi-ul', UE:'rfi-ue', INFO:'rfi-info', JURIDISK:'rfi-juridisk', TEKNISK:'rfi-teknisk' };
    const rfiOpen   = (t.rfi || []).filter(r => r.status !== 'BESVARET');
    const rfiDone   = (t.rfi || []).filter(r => r.status === 'BESVARET');
    const rfiHtml = rfiOpen.length > 0
        ? `<div class="rfi-block">
            <span class="rfi-label">Afvent / RFI${rfiDone.length ? ` · ${rfiDone.length} lukket` : ''}</span>
            ${rfiOpen.map(r => {
                const statusCls = r.status === 'AFVENTER' ? ' rfi-afventer' : r.status === 'DELVIS' ? ' rfi-delvis' : '';
                return `<span class="rfi-item ${rfiColors[r.type]||'rfi-info'}${statusCls}" title="${escHtml(r.status||r.type)}">${rfiIcons[r.type]||'📋'} ${escHtml(r.tekst)}</span>`;
            }).join('')}
           </div>`
        : (rfiDone.length > 0
            ? `<div class="rfi-block rfi-block--done"><span class="rfi-label">✓ Alle RFI besvaret (${rfiDone.length})</span></div>`
            : '');

    const sistersHtml = sistersHere && sistersHere.length > 0
        ? `<div class="sister-block">
            <span class="sister-label">🔗 ${sistersHere.length + 1} virksomheder byder</span>
            <span class="sister-tag sister-tag--master">${escHtml(t.kundenavn.split(' ')[0])} <span class="sister-grade grade-${(t.kunde_grade||t.rating||'').toLowerCase()}">${t.kunde_grade || t.rating || '?'}</span></span>
            ${sistersHere.map(s => {
                const g = s.kunde_grade || s.rating || '?';
                const gc = g === 'Ny' ? 'unknown' : g.toLowerCase();
                return `<span class="sister-tag">${escHtml(s.kundenavn.split(' ')[0])} <span class="sister-grade grade-${gc}">${g}</span></span>`;
            }).join('')}
           </div>`
        : '';

    const btEditHtml = t.bt_estimated
        ? `<div class="card-edit-bt">
            <span class="bt-label">BT estimeret</span>
            <input class="bt-input" type="number" value="${t.beregnertid}" step="0.5" min="0"
                onchange="onBTChange('${t.tilbudsnr}', this.value)" onclick="event.stopPropagation()">
            <span class="bt-unit">t — klik for at bekræfte</span>
           </div>`
        : `<div class="card-edit-bt card-edit-bt--ok">
            <span class="bt-label bt-label--ok">BT</span>
            <input class="bt-input bt-input--ok" type="number" value="${t.beregnertid}" step="0.5" min="0"
                onchange="onBTChange('${t.tilbudsnr}', this.value)" onclick="event.stopPropagation()">
            <span class="bt-unit">timer total</span>
           </div>`;

    const riskTooltip = {
        '🟢': '3+ dages margin til deadline — OK',
        '🟡': '0–2 dages margin til deadline — Stramt',
        '🔴': 'Planlagt aflevering er EFTER deadline',
        '⚪': 'Ingen deadline sat'
    }[t.risk] || '';

    const gradeTooltip = {
        'A': 'Grade A — Topkunde, høj hit-rate og volumen',
        'B': 'Grade B — Solid kunde, god historik',
        'C': 'Grade C — Lav hit-rate eller tynd historik'
    }[grade] || 'Ny kunde — ingen tidligere historik i systemet';

    const dlClass = isOverdue ? 'card-dl dl-over' : (t.risk === '🔴' ? 'card-dl dl-miss' : t.risk === '🟡' ? 'card-dl dl-tight' : 'card-dl');

    // Foranalyse-badge — åbn fil direkte hvis foranalyse_url findes, ellers kopiér sti
    const hasFa = t.foranalyse_kilde && t.foranalyse_sti;
    const faHtml = t.is_sister ? '' : hasFa
        ? (t.foranalyse_url
            ? `<a class="kpi-tile kpi-fa kpi-fa--ok" href="${escHtml(t.foranalyse_url)}"
                   title="Foranalyse: ${escHtml(t.foranalyse_kilde)}\nKlik for at åbne filen"
                   onclick="event.stopPropagation()">📄 FA</a>`
            : `<button class="kpi-tile kpi-fa kpi-fa--ok"
                   title="Foranalyse: ${escHtml(t.foranalyse_kilde)}\nKlik for at kopiere sti"
                   onclick="event.stopPropagation(); openForanalyse('${escHtml(t.tilbudsnr)}', '${escHtml(t.foranalyse_sti)}', '${escHtml(t.foranalyse_kilde)}')">📄 FA</button>`)
        : `<span class="kpi-tile kpi-fa kpi-fa--missing"
               title="Foranalyse ikke lavet endnu\nTilføj dokument i: FÆLLES/…/Tilbud 2026/${escHtml(t.tilbudsnr)}…/02 Tilbud/02.08 Foranalyse/">⚠ FA</span>`;

    const pipelineBadge = t._pipeline_overridden
        ? `<div class="card-pipeline-badge card-pipeline-badge--fixed" title="Pipeline justerede planen: ${t._pipeline_overridden.old_planned_end} → ${t._pipeline_overridden.new_planned_end}">🔧 Justeret af pipeline</div>`
        : t._ja_decision
        ? `<div class="card-pipeline-badge card-pipeline-badge--ja" title="Tom: ${t._ja_decision.tracker_end} · Excel: ${t._ja_decision.excel_finish} (${t._ja_decision.days_saved}d hurtigere). JA beslutter.">⚡ JA kan optimere ${t._ja_decision.days_saved}d</div>`
        : '';

    return `<div class="card ${riskBorder}${t.bt_estimated ? ' card-estimated' : ''}${t._pipeline_overridden ? ' card-pipeline-fixed' : ''}${t._ja_decision ? ' card-ja-decision' : ''}"
        draggable="true" data-tnr="${escHtml(t.tilbudsnr)}" data-date="${date}"
        ondragstart="onDragStart(event)" ondragend="onDragEnd(event)">
        <div class="card-header">
            <span class="drag-handle" title="Træk for at flytte">⠿</span>
            <span class="card-tnr">${escHtml(t.tilbudsnr)}</span>
            <span class="card-kunde">${escHtml(t.kundenavn)}</span>
            <span class="card-hours">${formatNum(hoursToday)}t</span>
            ${t.deadline ? `<span class="${dlClass}">DL ${formatDateShort(t.deadline)}</span>` : ''}
        </div>
        ${pipelineBadge}
        <div class="card-body">
            <div class="card-projekt">${escHtml(t.projekt || t.tilbudsnavn)}</div>
            ${beskr ? `<div class="card-beskr-wrap">${beskr}</div>` : ''}
        </div>
        <div class="card-kpis">
            <span class="kpi-tile ${getRiskClass(t.risk)}" data-tooltip="${escHtml(riskTooltip)}">Margin: ${marginText}</span>
            <span class="kpi-tile ${gradeClass}" data-tooltip="${escHtml(gradeTooltip)}">Kunde: ${grade || 'Ny'}${t.rating_score ? ` (${Math.round(t.rating_score)})` : ''}</span>
            ${t.must_win  ? `<span class="kpi-tile kpi-mw"   data-tooltip="Must Win — strategisk kritisk tilbud">⚡ Must Win</span>` : ''}
            ${t.high_ref  ? `<span class="kpi-tile kpi-href" data-tooltip="Høj referenceverdi — vigtigt referenceprojekt">★ Ref</span>` : ''}
            <span class="kpi-tile kpi-bt" data-tooltip="Beregnertid${t.bt_estimated ? ' — estimeret, klik for at bekræfte' : ''}">BT: ${formatNum(t.beregnertid)}t${t.bt_estimated ? ' ~' : ''}</span>
            ${faHtml}
            ${(t.scheduled_days && t.scheduled_days.length > 1)
                ? `<button class="card-split-btn card-split-btn--merge" title="Saml projektet til én dag (flex)"
                    onclick="event.stopPropagation(); onMergeCard('${escHtml(t.tilbudsnr)}')">⊕ Saml</button>`
                : `<button class="card-split-btn" title="Del fra denne dag (fordel over dage med normal kapacitet)"
                    onclick="event.stopPropagation(); onSplitCard('${escHtml(t.tilbudsnr)}', '${date}')">✂ Del</button>`
            }
        </div>
        ${rfiHtml}${sistersHtml}${btEditHtml}
    </div>`;
}

function renderSisterCard(t) {
    return `<div class="card-sister">
        <span class="sister-tnr">${escHtml(t.tilbudsnr)}</span>
        <span class="sister-info">${escHtml(t.kundenavn)} — Søster af ${escHtml(t.master_nr || '?')}</span>
    </div>`;
}

// ── EVENT HANDLERS ──

function onSplitCard(tilbudsNr, date) {
    pushUndo(`Del ${tilbudsNr}`);
    moveCard(state.queue, tilbudsNr, date); // no flexMax = normal 7.4t cap → natural split
    state.dirty = true;
    render();
    const t = state.queue.tilbud.find(x => x.tilbudsnr === tilbudsNr);
    const days = t && t.scheduled_days ? t.scheduled_days.length : 1;
    showToast(`${tilbudsNr} delt over ${days} dag${days !== 1 ? 'e' : ''}`);
}

function onMergeCard(tilbudsNr) {
    const t = state.queue.tilbud.find(x => x.tilbudsnr === tilbudsNr);
    if (!t || !t.scheduled_days || t.scheduled_days.length === 0) return;
    pushUndo(`Saml ${tilbudsNr}`);
    const startDay = t.scheduled_days[0];
    const flexMax  = state.queue.config.capacity_per_day * 2;
    moveCard(state.queue, tilbudsNr, startDay, flexMax);
    state.dirty = true;
    render();
    showToast(`${tilbudsNr} samlet fra ${formatDateShort(startDay)}`);
}

function openForanalyse(tnr, sti, kilde) {
    if (!sti || !kilde) return;
    const fullPath = sti + '/' + kilde;
    // Kopier fuld sti til clipboard
    if (navigator.clipboard) {
        navigator.clipboard.writeText(fullPath)
            .then(() => showToast(`📄 Foranalyse kopieret!\n\nÅbn Finder → ⌘⇧G → indsæt sti`, 4000))
            .catch(() => {});
    }
    // Forsøg at åbne filen direkte (virker i Safari, blokeres i Chrome)
    const t = state.queue.tilbud.find(x => x.tilbudsnr === tnr);
    const url = t && t.foranalyse_url;
    if (url) window.open(url, '_blank');
}

function onBTChange(tilbudsNr, newVal) {
    const bt = parseFloat(String(newVal).replace(',', '.'));
    if (isNaN(bt) || bt < 0) return;
    pushUndo(`BT ændret: ${tilbudsNr}`);
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
    document.getElementById('add-panel').classList.add('hidden');
}

// ── ADD TILBUD ──

function toggleAddTilbud() {
    const panel = document.getElementById('add-panel');
    const isHidden = panel.classList.toggle('hidden');
    if (!isHidden) {
        document.getElementById('settings-panel').classList.add('hidden');
        // Sæt default deadline til 3 uger frem
        const d = new Date();
        d.setDate(d.getDate() + 21);
        document.getElementById('add-deadline').value = _ymd(d.getFullYear(), d.getMonth()+1, d.getDate());
        document.getElementById('add-tnr').focus();
    }
}

function addTilbudToQueue() {
    const tnr    = document.getElementById('add-tnr').value.trim().toUpperCase();
    const kunde  = document.getElementById('add-kunde').value.trim();
    const projekt = document.getElementById('add-projekt').value.trim();
    const deadline = document.getElementById('add-deadline').value;
    const bt     = parseFloat(String(document.getElementById('add-bt').value).replace(',','.')) || 0;
    const grade  = document.getElementById('add-grade').value;
    const scope  = parseInt(document.getElementById('add-scope').value) || null;
    const mustWin = document.getElementById('add-mw').checked;
    const highRef = document.getElementById('add-ref').checked;

    if (!tnr || !kunde) {
        showToast('⚠ Tilbudsnr og Kundenavn er påkrævet', 3500);
        return;
    }
    if (state.queue.tilbud.some(t => t.tilbudsnr === tnr)) {
        showToast(`⚠ ${tnr} findes allerede i planen`, 3500);
        return;
    }

    pushUndo(`Tilføj ${tnr}`);

    const newTilbud = {
        tilbudsnr:    tnr,
        tilbudsnavn:  projekt || `${tnr} — ${kunde}`,
        kundenavn:    kunde,
        projekt:      projekt,
        deadline:     deadline || null,
        beregnertid:  bt,
        bt_estimated: bt === 0,
        bt_source:    'manual',
        kunde_grade:  grade || null,
        rating:       grade || 'Ny',
        must_win:     mustWin,
        high_ref:     highRef,
        steel_scope:  scope,
        risk:         '⚪',
        scheduled_days: [],
        planned_end:  null,
        is_sister:    false,
        beskrivelse:  '',
        sidst_aendret: todayStr(),
        _manual_entry: true,
    };

    state.queue.tilbud.push(newTilbud);
    state.dirty = true;
    toggleAddTilbud();

    // Nulstil form
    ['add-tnr','add-kunde','add-projekt','add-bt','add-scope'].forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('add-grade').value = '';
    document.getElementById('add-mw').checked = false;
    document.getElementById('add-ref').checked = false;

    render();
    showToast(`${tnr} tilføjet — træk det ind i planen eller kør Re-optimer`);
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
            showStatus('⚠ Konflikt — reload for at synkronisere');
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
        if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undoLast(); }
        if (e.key === 'Escape') {
            document.getElementById('settings-panel').classList.add('hidden');
            document.getElementById('help-panel').classList.add('hidden');
            document.getElementById('onboarding-overlay').classList.add('hidden');
        }
    });
}

function showStatus(msg) {
    const el = document.getElementById('save-status');
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; }, 5000);
}

function showToast(msg, duration = 5500) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast-show')));
    setTimeout(() => {
        toast.classList.remove('toast-show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

window.addEventListener('DOMContentLoaded', init);
