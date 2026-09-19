const DAY = 86400000;
export const CALENDAR_FIELDS = new Set(['referenceDate', 'rangeStart', 'rangeEnd', 'boundaryStart', 'boundaryEnd', 'selectedDays']);
const dayKey = time => new Date(time).toISOString().split('T')[0];
const midnight = day => Date.parse(`${day}T00:00:00.000Z`);
const monthNames = Array.from({length: 12}, (_, month) => new Intl.DateTimeFormat('en', {month: 'long', timeZone: 'UTC'}).format(new Date(Date.UTC(2026, month, 1))));
const labelDate = day => new Intl.DateTimeFormat('en', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'}).format(new Date(midnight(day)));
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};

/** Select whole UTC days; the first and last selected days set both boundaries.
 * Preserve imported time precision until the user actually edits the calendar.
 */
export class DateCalendar {
  constructor(container) {
    this.container = container;
    container.id = 'date-calendar';
    container.classList.add('date-calendar');
    const modes = node('div', 'calendar-modes');
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Choose what to select on the calendar');
    this.modeButtons = new Map();
    for (const [mode, label] of [['days', 'Timeline days'], ['reference', 'Reference date']]) {
      const button = node('button', '', label);
      button.type = 'button';
      button.id = `calendar-mode-${mode}`;
      button.addEventListener('click', () => { this.mode = mode; this.render(); });
      this.modeButtons.set(mode, button);
      modes.append(button);
    }
    this.help = node('p', 'calendar-help');
    this.help.id = 'calendar-help';
    const navigation = node('div', 'calendar-navigation');
    const previous = node('button', '', '‹');
    previous.type = 'button';
    previous.id = 'calendar-previous';
    previous.setAttribute('aria-label', 'Previous month');
    previous.addEventListener('click', () => this.changeMonth(-1));
    this.monthInput = node('select');
    this.monthInput.setAttribute('aria-label', 'Calendar month');
    monthNames.forEach((label, index) => {
      const option = node('option', '', label);
      option.value = index;
      this.monthInput.append(option);
    });
    this.monthInput.addEventListener('change', () => { this.month = Number(this.monthInput.value); this.render(); });
    this.yearInput = node('input');
    this.yearInput.type = 'number';
    this.yearInput.min = 1000;
    this.yearInput.max = 9999;
    this.yearInput.setAttribute('aria-label', 'Calendar year');
    this.yearInput.addEventListener('change', () => {
      const year = Number(this.yearInput.value);
      if (Number.isInteger(year) && year >= 1000 && year <= 9999) this.year = year;
      this.render();
    });
    const next = node('button', '', '›');
    next.type = 'button';
    next.id = 'calendar-next';
    next.setAttribute('aria-label', 'Next month');
    next.addEventListener('click', () => this.changeMonth(1));
    navigation.append(previous, this.monthInput, this.yearInput, next);
    this.table = node('table', 'calendar-grid');
    this.table.setAttribute('aria-describedby', 'calendar-help');
    this.caption = node('caption', 'visually-hidden');
    const head = node('thead'), headings = node('tr');
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      const cell = node('th', '', day);
      cell.scope = 'col';
      headings.append(cell);
    }
    head.append(headings);
    this.body = node('tbody');
    this.table.append(this.caption, head, this.body);
    const actions = node('div', 'calendar-actions');
    const clear = node('button', '', 'Clear selection');
    clear.type = 'button';
    clear.id = 'calendar-clear';
    clear.addEventListener('click', () => {
      this.days.clear();
      this.anchor = null;
      this.mode = 'days';
      this.selectionError = null;
      this.render();
    });
    actions.append(clear);
    this.summary = node('p', 'calendar-summary');
    this.summary.id = 'calendar-summary';
    this.summary.setAttribute('aria-live', 'polite');
    this.reference = node('p', 'calendar-reference');
    this.reference.id = 'calendar-reference';
    this.reference.setAttribute('aria-live', 'polite');
    container.append(modes, this.help, navigation, this.table, actions, this.summary, this.reference);
  }

  setValue(config) {
    this.values = Object.fromEntries([...CALENDAR_FIELDS].map(field => [field, structuredClone(config[field] ?? (field === 'selectedDays' ? [] : null))]));
    const begin = Math.max(Date.parse(config.rangeStart), config.boundaryStart === null ? -Infinity : Date.parse(config.boundaryStart));
    const finish = Math.min(Date.parse(config.rangeEnd), config.boundaryEnd === null ? Infinity : Date.parse(config.boundaryEnd));
    this.days = new Set(config.selectedDays ?? []);
    if (!this.days.size) {
      for (let time = Math.floor(begin / DAY) * DAY; time < finish; time += DAY) this.days.add(dayKey(time));
    }
    const reference = new Date(config.referenceDate);
    this.year = reference.getUTCFullYear();
    this.month = reference.getUTCMonth();
    this.mode = 'days';
    this.selectionError = null;
    this.anchor = null;
    this.container.removeAttribute('aria-invalid');
    this.render();
  }

  getValue() {
    this.container.removeAttribute('aria-invalid');
    if (this.selectionError) {
      const error = new Error(this.selectionError);
      error.errors = [`selectedDays: ${this.selectionError}`];
      throw error;
    }
    if (!this.days.size) {
      const error = new Error('Select at least one timeline day on the calendar.');
      error.errors = ['selectedDays: select at least one timeline day on the calendar.'];
      throw error;
    }
    return structuredClone(this.values);
  }

  changeMonth(offset) {
    const date = new Date(Date.UTC(this.year, this.month + offset, 1));
    if (date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) return;
    this.year = date.getUTCFullYear();
    this.month = date.getUTCMonth();
    this.render();
  }

  select(day, extend = false) {
    this.container.removeAttribute('aria-invalid');
    this.selectionError = null;
    if (this.mode === 'reference') {
      // Noon allows a single selected day to contain both past and future events.
      this.values.referenceDate = new Date(midnight(day) + DAY / 2).toISOString();
    } else {
      if (extend && this.anchor) {
        const first = Math.min(midnight(this.anchor), midnight(day));
        const last = Math.max(midnight(this.anchor), midnight(day));
        if ((last - first) / DAY >= 3660) this.selectionError = 'Select a range of at most 3,660 days.';
        else for (let time = first; time <= last; time += DAY) this.days.add(dayKey(time));
      } else if (this.days.has(day)) this.days.delete(day);
      else this.days.add(day);
      this.anchor = day;
      if (this.days.size) {
        const selected = [...this.days].sort();
        this.values.selectedDays = selected;
        this.values.rangeStart = this.values.boundaryStart = new Date(midnight(selected[0])).toISOString();
        this.values.rangeEnd = this.values.boundaryEnd = new Date(midnight(selected.at(-1)) + DAY).toISOString();
        const reference = Date.parse(this.values.referenceDate);
        if (reference <= Date.parse(this.values.rangeStart) || reference >= Date.parse(this.values.rangeEnd)) {
          this.values.referenceDate = new Date(midnight(selected[Math.floor(selected.length / 2)]) + DAY / 2).toISOString();
        }
      }
    }
    const date = new Date(midnight(day));
    this.year = date.getUTCFullYear();
    this.month = date.getUTCMonth();
    this.render();
    this.body.querySelector(`[data-date="${day}"]`)?.focus();
  }

  keydown(event, day) {
    const offsets = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7};
    let time = midnight(day);
    if (event.key in offsets) time += offsets[event.key] * DAY;
    else if (event.key === 'Home') time -= (new Date(time).getUTCDay() + 6) % 7 * DAY;
    else if (event.key === 'End') time += (6 - (new Date(time).getUTCDay() + 6) % 7) * DAY;
    else return;
    const date = new Date(time);
    if (date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) return;
    event.preventDefault();
    this.year = date.getUTCFullYear();
    this.month = date.getUTCMonth();
    this.render();
    this.body.querySelector(`[data-date="${dayKey(time)}"]`)?.focus();
  }

  render() {
    for (const [mode, button] of this.modeButtons) button.setAttribute('aria-pressed', String(mode === this.mode));
    this.help.textContent = this.mode === 'days'
      ? 'Click days to select or remove them. Shift-click to select a range. The first and last days set the boundaries.'
      : 'Click a day to divide past and future events at noon (UTC).';
    this.monthInput.value = this.month;
    this.yearInput.value = this.year;
    this.caption.textContent = `${monthNames[this.month]} ${this.year}`;
    this.body.replaceChildren();
    const first = Date.UTC(this.year, this.month, 1);
    const gridStart = first - (new Date(first).getUTCDay() + 6) % 7 * DAY;
    const referenceDay = dayKey(Date.parse(this.values.referenceDate));
    const today = dayKey(Date.now());
    for (let week = 0; week < 6; week++) {
      const row = node('tr');
      for (let index = 0; index < 7; index++) {
        const time = gridStart + (week * 7 + index) * DAY;
        const date = new Date(time), day = dayKey(time);
        const cell = node('td');
        const button = node('button', 'calendar-day', String(date.getUTCDate()));
        button.type = 'button';
        button.dataset.date = day;
        button.classList.toggle('is-selected', this.days.has(day));
        button.classList.toggle('is-reference', day === referenceDay);
        button.classList.toggle('other-month', date.getUTCMonth() !== this.month);
        button.setAttribute('aria-pressed', String(this.mode === 'days' ? this.days.has(day) : day === referenceDay));
        button.setAttribute('aria-label', `${labelDate(day)}${day === referenceDay ? ', reference date' : ''}`);
        if (day === today) button.setAttribute('aria-current', 'date');
        button.disabled = date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999 || day === '9999-12-31';
        button.addEventListener('click', event => this.select(day, event.shiftKey));
        button.addEventListener('keydown', event => this.keydown(event, day));
        cell.append(button);
        row.append(cell);
      }
      this.body.append(row);
    }
    const selected = [...this.days].sort();
    this.summary.textContent = this.selectionError || (selected.length
      ? `${selected.length} ${selected.length === 1 ? 'day' : 'days'} selected · ${labelDate(selected[0])}${selected.length > 1 ? ' – ' + labelDate(selected.at(-1)) : ''}`
      : 'No days selected. Choose days to set your timeline boundaries.');
    const time = new Date(this.values.referenceDate).toISOString().slice(11, 16);
    this.reference.textContent = `Reference: ${labelDate(referenceDay)}, ${time} UTC · marked with a ring`;
  }
}
