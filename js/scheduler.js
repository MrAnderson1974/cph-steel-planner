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

    // Reset existing entries
    for (const date in queue.day_capacity) {
        queue.day_capacity[date].used = usedMap[date] || 0;
    }

    // Add newly created dates
    for (const date in usedMap) {
        if (!queue.day_capacity[date]) {
            queue.day_capacity[date] = { used: usedMap[date], capacity: cap };
        }
    }
}

function getDayAvailable(queue, date) {
    const cap = queue.config.capacity_per_day;
    const info = queue.day_capacity[date];
    const used = info ? info.used : 0;
    return Math.max(0, cap - used);
}

function moveCard(queue, tilbudsNr, targetDate) {
    const tilbud = queue.tilbud.find(t => t.tilbudsnr === tilbudsNr);
    if (!tilbud || tilbud.is_sister || !tilbud.beregnertid) return;

    const sisterIds = tilbud.is_master ? (tilbud.sisters || []) : [];

    // Remove this card and its sister display entries from all days
    for (const date of Object.keys(queue.schedule)) {
        queue.schedule[date] = queue.schedule[date].filter(e =>
            e.tilbudsnr !== tilbudsNr && !sisterIds.includes(e.tilbudsnr)
        );
        if (queue.schedule[date].length === 0) delete queue.schedule[date];
    }

    rebuildDayCapacity(queue);

    // Pack card starting from targetDate
    let remaining = tilbud.beregnertid;
    let current = targetDate;
    const newDays = [];
    let safety = 0;

    while (remaining > 0.01 && safety < 400) {
        safety++;
        if (isWorkingDay(current, queue.config.holidays)) {
            const available = getDayAvailable(queue, current);
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
    tilbud.planned_end = newDays.length > 0 ? newDays[newDays.length - 1] : null;
    tilbud.risk = calculateRisk(tilbud);

    // Add sister display entries on first day only
    if (tilbud.is_master && sisterIds.length > 0 && newDays.length > 0) {
        const firstDay = newDays[0];
        if (!queue.schedule[firstDay]) queue.schedule[firstDay] = [];
        for (const sisterId of sisterIds) {
            const alreadyThere = queue.schedule[firstDay].some(e => e.tilbudsnr === sisterId);
            if (!alreadyThere) {
                queue.schedule[firstDay].push({ tilbudsnr: sisterId, hours: 0, is_sister_display: true });
            }
            const sister = queue.tilbud.find(t => t.tilbudsnr === sisterId);
            if (sister) {
                sister.scheduled_days = [];
                sister.planned_end = null;
            }
        }
    }
}

function updateBeregnertid(queue, tilbudsNr, newBT) {
    const tilbud = queue.tilbud.find(t => t.tilbudsnr === tilbudsNr);
    if (!tilbud) return;
    const startDate = tilbud.scheduled_days && tilbud.scheduled_days.length > 0
        ? tilbud.scheduled_days[0]
        : todayStr();
    tilbud.beregnertid = newBT;
    tilbud.bt_estimated = false;
    moveCard(queue, tilbudsNr, startDate);
}
