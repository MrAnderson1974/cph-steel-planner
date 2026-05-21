'use strict';

function calculateRisk(tilbud) {
    if (tilbud.is_sister && tilbud.beregnertid === 0) return '⚪';
    if (!tilbud.deadline) return '⚪';
    if (!tilbud.planned_end) {
        return tilbud.deadline < todayStr() ? '🔴' : '⚪';
    }
    if (tilbud.planned_end > tilbud.deadline) return '🔴';
    const margin = daysBetween(tilbud.planned_end, tilbud.deadline);
    return margin >= 3 ? '🟢' : '🟡';
}

function rebuildDayCapacity(queue) {
    const cap = queue.config.capacity_per_day;
    const usedMap = {};

    for (const [date, items] of Object.entries(queue.schedule)) {
        let used = 0;
        for (const item of items) {
            if (!item.is_sister_display) used += (item.hours || 0);
        }
        usedMap[date] = used;
    }

    for (const date in queue.day_capacity) {
        queue.day_capacity[date].used = usedMap[date] || 0;
    }

    for (const date in usedMap) {
        if (!queue.day_capacity[date]) {
            queue.day_capacity[date] = { used: usedMap[date], capacity: cap };
        }
    }
}

function getDayAvailable(queue, date, flexMax) {
    const cap = flexMax !== undefined ? flexMax : queue.config.capacity_per_day;
    const info = queue.day_capacity[date];
    return Math.max(0, cap - (info ? info.used : 0));
}

// flexMax: override max hours per day (for flex drag). Omit = normal 7.4t cap.
function moveCard(queue, tilbudsNr, targetDate, flexMax) {
    const tilbud = queue.tilbud.find(t => t.tilbudsnr === tilbudsNr);
    if (!tilbud || tilbud.is_sister || !tilbud.beregnertid) return;

    const sisterIds = tilbud.is_master ? (tilbud.sisters || []) : [];

    // Remove this card and its sisters from all days
    for (const date of Object.keys(queue.schedule)) {
        queue.schedule[date] = queue.schedule[date].filter(e =>
            e.tilbudsnr !== tilbudsNr && !sisterIds.includes(e.tilbudsnr)
        );
        if (queue.schedule[date].length === 0) delete queue.schedule[date];
    }

    rebuildDayCapacity(queue);

    // Pack from targetDate
    let remaining = tilbud.beregnertid;
    let current   = targetDate;
    const newDays = [];
    let safety    = 0;

    while (remaining > 0.01 && safety < 400) {
        safety++;
        if (isWorkingDay(current, queue.config.holidays)) {
            const available = getDayAvailable(queue, current, flexMax);
            if (available > 0.01) {
                const hours = Math.min(remaining, available);
                if (!queue.schedule[current]) queue.schedule[current] = [];
                queue.schedule[current].push({ tilbudsnr: tilbudsNr, hours });

                if (!queue.day_capacity[current]) {
                    queue.day_capacity[current] = { used: 0, capacity: queue.config.capacity_per_day };
                }
                queue.day_capacity[current].used += hours;

                if (!newDays.includes(current)) newDays.push(current);
                remaining -= hours;
            }
        }
        current = addDays(current, 1);
    }

    tilbud.scheduled_days = newDays;
    tilbud.planned_end    = newDays.length > 0 ? newDays[newDays.length - 1] : null;
    tilbud.risk           = calculateRisk(tilbud);

    // Sister display entries on first day
    if (tilbud.is_master && sisterIds.length > 0 && newDays.length > 0) {
        const firstDay = newDays[0];
        if (!queue.schedule[firstDay]) queue.schedule[firstDay] = [];
        for (const sisterId of sisterIds) {
            if (!queue.schedule[firstDay].some(e => e.tilbudsnr === sisterId)) {
                queue.schedule[firstDay].push({ tilbudsnr: sisterId, hours: 0, is_sister_display: true });
            }
            const sister = queue.tilbud.find(t => t.tilbudsnr === sisterId);
            if (sister) { sister.scheduled_days = []; sister.planned_end = null; }
        }
    }
}

function updateBeregnertid(queue, tilbudsNr, newBT) {
    const tilbud = queue.tilbud.find(t => t.tilbudsnr === tilbudsNr);
    if (!tilbud) return;
    const startDate = tilbud.scheduled_days && tilbud.scheduled_days.length > 0
        ? tilbud.scheduled_days[0]
        : todayStr();
    tilbud.beregnertid  = newBT;
    tilbud.bt_estimated = false;
    moveCard(queue, tilbudsNr, startDate);
}

// ── AUTOMATIONER ──

function _calcPriorityScore(tilbud, today) {
    let urgency = 1;
    if (tilbud.deadline) {
        const [y, m, d] = today.split('-').map(Number);
        const [dy, dm, dd] = tilbud.deadline.split('-').map(Number);
        const daysLeft = Math.round((new Date(dy, dm-1, dd) - new Date(y, m-1, d)) / 86400000);
        if      (daysLeft <= 5)  urgency = 5;
        else if (daysLeft <= 10) urgency = 4;
        else if (daysLeft <= 20) urgency = 3;
        else if (daysLeft <= 35) urgency = 2;
        else                     urgency = 1;
    }
    const gradePts   = ({ A: 3, B: 2, C: 1 }[tilbud.kunde_grade]) || 1;
    const steelScope = tilbud.steel_scope || 1;
    const bonus      = (tilbud.must_win ? 2 : 0) + (tilbud.high_ref ? 1 : 0);
    const sisterBonus = tilbud.is_master ? 3 : 0;
    return (urgency * 8) + (steelScope * 6) + (gradePts * 5) + (bonus * 2) + sisterBonus;
}

function _clearAllSchedule(queue) {
    for (const date of Object.keys(queue.schedule)) {
        queue.schedule[date] = [];
    }
    rebuildDayCapacity(queue);
}

function reOptimer(queue) {
    const today = todayStr();
    _clearAllSchedule(queue);

    const schedulable = queue.tilbud
        .filter(t => !t.is_sister && t.beregnertid > 0)
        .sort((a, b) => {
            const aDays = a.deadline ? daysBetween(today, a.deadline) : 9999;
            const bDays = b.deadline ? daysBetween(today, b.deadline) : 9999;
            // EDF for imminent deadlines — earliest deadline gets first capacity slot
            if (aDays <= 14 || bDays <= 14) {
                if (aDays !== bDays) return aDays - bDays;
            }
            return _calcPriorityScore(b, today) - _calcPriorityScore(a, today);
        });

    for (const t of schedulable) {
        moveCard(queue, t.tilbudsnr, today);
    }

    for (const t of queue.tilbud) {
        t.risk = calculateRisk(t);
    }
}

function pakSchedule(queue) {
    const today = todayStr();

    const scheduled = queue.tilbud
        .filter(t => !t.is_sister && t.beregnertid > 0 && t.scheduled_days && t.scheduled_days.length > 0)
        .sort((a, b) => (a.scheduled_days[0] || '').localeCompare(b.scheduled_days[0] || ''));

    const unscheduled = queue.tilbud
        .filter(t => !t.is_sister && t.beregnertid > 0 && (!t.scheduled_days || t.scheduled_days.length === 0));

    _clearAllSchedule(queue);

    for (const t of [...scheduled, ...unscheduled]) {
        moveCard(queue, t.tilbudsnr, today);
    }

    for (const t of queue.tilbud) {
        t.risk = calculateRisk(t);
    }
}
