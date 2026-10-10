import { adjustTextareaHeight } from './adjusttextarea.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const picker = document.getElementById('draw-date-picker');
const monthLabel = document.getElementById('draw-date-month');
const yearInput = document.getElementById('draw-date-year');
const grid = document.getElementById('draw-date-grid');
const hourInput = document.getElementById('draw-date-hour');
const minuteInput = document.getElementById('draw-date-minute');
const preview = document.getElementById('draw-date-preview');
const useButton = document.getElementById('draw-date-use');
const title = document.getElementById('draw-date-title');

let kind = 'marker';
let applyMode = 'number';
let filterDateId = '';
let filterTimeId = '';
let filterButton = null;
let selected = new Date();
let viewYear = selected.getFullYear();
let viewMonth = selected.getMonth();

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateNumber(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function sameMinute(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
    && a.getHours() === b.getHours()
    && a.getMinutes() === b.getMinutes();
}

function filterStamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readFilterDate(dateId, timeId) {
  const dateValue = document.getElementById(dateId).value;
  const timeValue = document.getElementById(timeId).value;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!dateMatch) return null;
  const timeMatch = /^(\d{2}):(\d{2})/.exec(timeValue);
  return new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    timeMatch ? Number(timeMatch[1]) : 0,
    timeMatch ? Number(timeMatch[2]) : 0,
    0,
    0
  );
}

function labelFilterButton(button) {
  const dateValue = document.getElementById(button.dataset.dateId).value;
  const timeValue = document.getElementById(button.dataset.timeId).value;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(dateValue);
  const timeOk = /^\d{2}:\d{2}/.test(timeValue);
  if (!dateOk) {
    button.textContent = button.dataset.label;
    return;
  }
  button.textContent = timeOk ? `${dateValue}  ${timeValue.slice(0, 5)}` : dateValue;
}

export function refreshFilterTimeButtons() {
  document.querySelectorAll('.filter-time-open').forEach(labelFilterButton);
}

function updatePreview() {
  const now = new Date();
  preview.textContent = applyMode === 'filter' ? filterStamp(selected) : dateNumber(selected);
  useButton.textContent = sameMinute(selected, now) ? 'Use current' : 'Use this date';
}

function setViewYear(year) {
  const nextYear = Math.min(9999, Math.max(1000, year));
  viewYear = nextYear;
  const lastDay = new Date(nextYear, viewMonth + 1, 0).getDate();
  const day = Math.min(selected.getDate(), lastDay);
  selected.setFullYear(nextYear, viewMonth, day);
  render();
}

function render() {
  monthLabel.textContent = MONTHS[viewMonth];
  if (document.activeElement !== yearInput) yearInput.value = String(viewYear);
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const today = new Date();
  grid.replaceChildren();
  const blank = () => {
    const cell = document.createElement('span');
    cell.className = 'draw-date-day draw-date-day-blank';
    return cell;
  };
  for (let i = 0; i < firstWeekday; i++) grid.appendChild(blank());
  for (let day = 1; day <= daysInMonth; day++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'draw-date-day';
    button.dataset.day = String(day);
    button.textContent = String(day);
    if (selected.getFullYear() === viewYear && selected.getMonth() === viewMonth && selected.getDate() === day) {
      button.classList.add('is-selected');
    }
    if (today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day) {
      button.classList.add('is-today');
    }
    grid.appendChild(button);
  }
  while (grid.childElementCount < 42) grid.appendChild(blank());
  hourInput.value = pad(selected.getHours());
  minuteInput.value = pad(selected.getMinutes());
  updatePreview();
}

function setToNow() {
  selected = new Date();
  selected.setSeconds(0, 0);
  viewYear = selected.getFullYear();
  viewMonth = selected.getMonth();
  render();
}

function closeDrawDatePicker() {
  picker.style.display = 'none';
  applyMode = 'number';
  title.textContent = 'Pick date and time';
}

function applySelection() {
  if (applyMode === 'filter') {
    const dateEl = document.getElementById(filterDateId);
    const timeEl = document.getElementById(filterTimeId);
    dateEl.value = `${selected.getFullYear()}-${pad(selected.getMonth() + 1)}-${pad(selected.getDate())}`;
    timeEl.value = `${pad(selected.getHours())}:${pad(selected.getMinutes())}`;
    if (filterButton) labelFilterButton(filterButton);
    closeDrawDatePicker();
    return;
  }
  const fieldId = kind === 'polygon' ? 'input-field-number-of-polygon' : 'input-field-number-of-marker';
  const field = document.getElementById(fieldId);
  field.value = dateNumber(selected);
  adjustTextareaHeight(field);
  closeDrawDatePicker();
}

function bump(part, direction) {
  if (part === 'hour') selected.setHours((selected.getHours() + direction + 24) % 24);
  else selected.setMinutes((selected.getMinutes() + direction + 60) % 60);
  render();
}

function commitTime(part) {
  const input = part === 'hour' ? hourInput : minuteInput;
  const max = part === 'hour' ? 23 : 59;
  let n = parseInt(input.value, 10);
  if (!Number.isInteger(n)) n = part === 'hour' ? selected.getHours() : selected.getMinutes();
  n = Math.min(max, Math.max(0, n));
  if (part === 'hour') selected.setHours(n);
  else selected.setMinutes(n);
  input.value = pad(n);
  updatePreview();
}

export function openDrawDatePicker(nextKind) {
  applyMode = 'number';
  kind = nextKind === 'polygon' ? 'polygon' : 'marker';
  title.textContent = 'Pick date and time';
  setToNow();
  picker.style.display = 'block';
  useButton.focus();
}

function openFilterDatePicker(button) {
  applyMode = 'filter';
  filterDateId = button.dataset.dateId;
  filterTimeId = button.dataset.timeId;
  filterButton = button;
  title.textContent = button.dataset.label;
  const existing = readFilterDate(filterDateId, filterTimeId);
  if (existing) {
    selected = existing;
    viewYear = selected.getFullYear();
    viewMonth = selected.getMonth();
    render();
  } else {
    setToNow();
  }
  picker.style.display = 'block';
  useButton.focus();
}

document.querySelectorAll('.filter-time-open').forEach((button) => {
  button.addEventListener('click', () => openFilterDatePicker(button));
});

picker.addEventListener('click', closeDrawDatePicker);
document.getElementById('draw-date-close').addEventListener('click', closeDrawDatePicker);
document.getElementById('draw-date-prev').addEventListener('click', () => {
  const next = new Date(viewYear, viewMonth - 1, 1);
  viewYear = next.getFullYear();
  viewMonth = next.getMonth();
  render();
});
document.getElementById('draw-date-next').addEventListener('click', () => {
  const next = new Date(viewYear, viewMonth + 1, 1);
  viewYear = next.getFullYear();
  viewMonth = next.getMonth();
  render();
});
document.getElementById('draw-date-year-prev').addEventListener('click', () => setViewYear(viewYear - 1));
document.getElementById('draw-date-year-next').addEventListener('click', () => setViewYear(viewYear + 1));
yearInput.addEventListener('input', () => {
  yearInput.value = yearInput.value.replace(/\D/g, '').slice(0, 4);
});
yearInput.addEventListener('change', () => {
  const typed = parseInt(yearInput.value, 10);
  if (!Number.isInteger(typed)) {
    yearInput.value = String(viewYear);
    return;
  }
  setViewYear(typed);
});
grid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-day]');
  if (!button) return;
  selected.setFullYear(viewYear, viewMonth, Number(button.dataset.day));
  render();
});
document.getElementById('draw-date-hour-down').addEventListener('click', () => bump('hour', -1));
document.getElementById('draw-date-hour-up').addEventListener('click', () => bump('hour', 1));
document.getElementById('draw-date-minute-down').addEventListener('click', () => bump('minute', -1));
document.getElementById('draw-date-minute-up').addEventListener('click', () => bump('minute', 1));
hourInput.addEventListener('input', () => { hourInput.value = hourInput.value.replace(/\D/g, '').slice(0, 2); });
minuteInput.addEventListener('input', () => { minuteInput.value = minuteInput.value.replace(/\D/g, '').slice(0, 2); });
hourInput.addEventListener('change', () => commitTime('hour'));
minuteInput.addEventListener('change', () => commitTime('minute'));
document.getElementById('draw-date-now').addEventListener('click', setToNow);
useButton.addEventListener('click', applySelection);

picker.addEventListener('keydown', (event) => {
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDrawDatePicker();
  }
});
picker.addEventListener('keyup', (event) => event.stopPropagation());

function keepMapStill(event) {
  if (picker.style.display === 'none') return;
  if (picker.contains(event.target)) return;
  event.stopPropagation();
  if (event.type === 'keydown' && event.key === 'Escape') closeDrawDatePicker();
}
document.addEventListener('keydown', keepMapStill, true);
document.addEventListener('keyup', keepMapStill, true);
