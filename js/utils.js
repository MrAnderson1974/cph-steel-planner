'use strict';

const DAYS_DA = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
const MONTHS_DA = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];

function todayStr() {
    const d = new Date();
    return _ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function _ymd(y, m, d) {
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return _ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

function isWeekend(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const day = new Date(y, m - 1, d).getDay();
    return day === 0 || day === 6;
}

function isHoliday(dateStr, holidays) {
    return Object.prototype.hasOwnProperty.call(holidays, dateStr);
}

function isWorkingDay(dateStr, holidays) {
    return !isWeekend(dateStr) && !isHoliday(dateStr, holidays);
}

function daysBetween(d1, d2) {
    const [y1,m1,dd1] = d1.split('-').map(Number);
    const [y2,m2,dd2] = d2.split('-').map(Number);
    return Math.round((new Date(y2,m2-1,dd2) - new Date(y1,m1-1,dd1)) / 86400000);
}

function formatDateLong(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return `${DAYS_DA[dt.getDay()]} ${d}. ${MONTHS_DA[m-1]} ${y}`;
}

function formatDateShort(dateStr) {
    const [, m, d] = dateStr.split('-').map(Number);
    return `${d}/${m}`;
}

function getISOWeek(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    return Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
}

function formatNum(n, dec) {
    if (n === null || n === undefined) return '—';
    const decimals = dec !== undefined ? dec : 1;
    return Number(n).toLocaleString('da-DK', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getWorkingDaysInRange(startDate, endDate, holidays) {
    const days = [];
    let current = startDate;
    while (current <= endDate) {
        if (isWorkingDay(current, holidays)) days.push(current);
        current = addDays(current, 1);
    }
    return days;
}

function groupByWeek(dates) {
    const weeks = new Map();
    for (const d of dates) {
        const w = getISOWeek(d);
        if (!weeks.has(w)) weeks.set(w, []);
        weeks.get(w).push(d);
    }
    return weeks;
}
