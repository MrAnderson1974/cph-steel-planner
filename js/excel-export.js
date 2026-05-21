'use strict';

function exportExcel() {
    if (typeof XLSX === 'undefined') {
        alert('SheetJS ikke indlæst — tjek internetforbindelsen.');
        return;
    }

    const queue = state.queue;
    const today = todayStr();
    const wb = XLSX.utils.book_new();

    // ── Fane 1: Dagplan ──
    const dagRows = [['Dato', 'Dag', 'Tilbudsnr', 'Projekt', 'Kunde', 'Timer (dag)', 'Total BT', 'Deadline', 'Risk', 'Phase']];
    const tilbudMap = Object.fromEntries(queue.tilbud.map(t => [t.tilbudsnr, t]));

    for (const date of Object.keys(queue.schedule).sort()) {
        for (const item of queue.schedule[date]) {
            if (item.is_sister_display) continue;
            const t = tilbudMap[item.tilbudsnr];
            if (!t) continue;
            dagRows.push([
                date,
                formatDateLong(date),
                t.tilbudsnr,
                t.projekt || t.tilbudsnavn,
                t.kundenavn,
                item.hours,
                t.beregnertid,
                t.deadline || '',
                t.risk || '',
                t.phase || ''
            ]);
        }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dagRows), 'Dagplan');

    // ── Fane 2: Projektoverblik ──
    const ovRows = [['Tilbudsnr','Projekt','Kunde','Deadline','BT (t)','Est.','Score','Grade','MW','HRef','Stål','Søster','Risk','Plan. slut','Beskrivelse']];
    const sorted = [...queue.tilbud].sort((a,b) => (b.priority_score||0) - (a.priority_score||0));
    for (const t of sorted) {
        ovRows.push([
            t.tilbudsnr,
            t.projekt || t.tilbudsnavn,
            t.kundenavn,
            t.deadline || '',
            t.beregnertid,
            t.bt_estimated ? 'Ja' : 'Nej',
            t.priority_score || '',
            t.kunde_grade || '',
            t.must_win ? 'Ja' : 'Nej',
            t.high_ref ? 'Ja' : 'Nej',
            t.steel_scope || '',
            t.is_sister ? `Søster: ${t.master_nr}` : (t.is_master ? `Master (${(t.sisters||[]).join(', ')})` : ''),
            t.risk || '',
            t.planned_end || '',
            t.beskrivelse || ''
        ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ovRows), 'Projektoverblik');

    // ── Fane 3: Eskalering ──
    const eskRows = [['Status','Tilbudsnr','Projekt','Kunde','Deadline','Plan. slut','BT (t)','Risk']];
    for (const t of sorted) {
        if (t.is_sister) continue;
        let status = null;
        if (t.deadline && t.deadline < today) status = 'OVERSKREDET';
        else if (t.risk === '🔴' && t.planned_end && t.deadline && t.planned_end > t.deadline) status = 'MISSER DEADLINE';
        else if (t.bt_estimated) status = 'MANGLER BT';
        if (!status) continue;
        eskRows.push([status, t.tilbudsnr, t.projekt || t.tilbudsnavn, t.kundenavn, t.deadline||'', t.planned_end||'', t.beregnertid, t.risk||'']);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(eskRows), 'Eskalering');

    XLSX.writeFile(wb, `CPH_Steel_Planner_${today}.xlsx`);
    showStatus(`Excel eksporteret`);
}
