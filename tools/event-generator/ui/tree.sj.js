import {CONFIG_FIELDS} from '../config.js';
import {DateCalendar, CALENDAR_FIELDS} from './calendar.js';

/**
 * Self-contained tree.sj configuration definition.
 * No external package named "tree.sj" was present in this repository. This local
 * schema-driven tree is deliberately dependency-free; replace its renderer to
 * integrate a particular third-party tree library without changing the engine.
 */
export const TREE_SJ = {
  id: 'timeline-generator',
  label: 'Timeline generation settings',
  children: [...new Set(CONFIG_FIELDS.map(field => field.group))].map((group, index) => ({
    id: `settings-${index}`,
    label: group,
    expanded: index < 2,
    children: CONFIG_FIELDS.filter(field => field.group === group).map(field => ({
      id: field.path, kind: 'parameter', ...field,
    })),
  })),
};

const get = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const set = (object, path, value) => {
  const parts = path.split('.');
  const last = parts.pop();
  parts.reduce((object, key) => object[key] ??= {}, object)[last] = value;
};

/** Native disclosure nodes provide a keyboard-accessible expandable tree. */
export class TreeSJEditor {
  constructor(container, config, definition = TREE_SJ) {
    this.container = container;
    this.inputs = new Map();
    this.definition = definition;
    container.replaceChildren();
    for (const group of definition.children) {
      const node = document.createElement('details');
      node.className = 'tree-node';
      node.open = group.expanded;
      const summary = document.createElement('summary');
      summary.textContent = group.label;
      node.append(summary);
      const fields = document.createElement('div');
      fields.className = 'tree-fields';
      for (const field of group.children) {
        if (CALENDAR_FIELDS.has(field.path)) {
          if (!this.calendar) {
            const calendar = document.createElement('div');
            this.calendar = new DateCalendar(calendar);
            fields.append(calendar);
          }
        } else fields.append(this.createField(field));
      }
      node.append(fields);
      container.append(node);
    }
    this.setValue(config);
  }

  createField(field) {
    const row = document.createElement('div');
    row.className = `field field-${field.type}`;
    const label = document.createElement('label');
    const id = `config-${field.path.replaceAll('.', '-')}`;
    label.htmlFor = id;
    label.textContent = field.label;
    const input = document.createElement(field.type === 'select' ? 'select' : field.type === 'json' ? 'textarea' : 'input');
    input.id = id;
    input.name = field.path;
    input.setAttribute('aria-describedby', `${id}-help`);
    if (field.type === 'select') {
      for (const option of field.options) {
        const element = document.createElement('option');
        element.value = option;
        element.textContent = option;
        input.append(element);
      }
    } else if (field.type === 'boolean') input.type = 'checkbox';
    else if (field.type === 'number' || field.type === 'integer') {
      input.type = 'number';
      input.step = field.step ?? (field.type === 'integer' ? 1 : 'any');
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
    } else if (field.type === 'time') input.type = 'time';
    else if (field.type === 'json') {
      input.rows = 4;
      input.spellcheck = false;
    } else {
      input.type = 'text';
      input.spellcheck = false;
      if (field.type.includes('date')) input.placeholder = '2026-01-15T00:00:00.000Z';
    }
    const help = document.createElement('small');
    help.id = `${id}-help`;
    help.textContent = field.description;
    row.append(label, input, help);
    this.inputs.set(field.path, {input, field});
    return row;
  }

  setValue(config) {
    this.calendar?.setValue(config);
    for (const {input, field} of this.inputs.values()) {
      const value = get(config, field.path);
      input.removeAttribute('aria-invalid');
      if (field.type === 'boolean') input.checked = value;
      else if (field.type === 'json') input.value = JSON.stringify(value, null, 2);
      else if (field.type === 'seed') input.value = JSON.stringify(value);
      else input.value = value ?? '';
    }
  }

  getValue() {
    const config = {}, errors = [];
    if (this.calendar) {
      try { Object.assign(config, this.calendar.getValue()); }
      catch (error) { errors.push(...error.errors ?? [error.message]); }
    }
    for (const {input, field} of this.inputs.values()) {
      input.removeAttribute('aria-invalid');
      let value;
      try {
        if (field.type === 'boolean') value = input.checked;
        else if (field.type === 'number' || field.type === 'integer') {
          if (!input.value.trim()) throw new Error('a number is required');
          value = Number(input.value);
        } else if (field.type === 'json') value = JSON.parse(input.value);
        else if (field.type === 'seed') {
          // Quoted strings preserve numeric-looking seeds; unquoted text is convenient.
          try { value = JSON.parse(input.value); } catch { value = input.value; }
        } else if (field.type === 'nullable-date' && !input.value.trim()) value = null;
        else value = input.value;
        set(config, field.path, value);
      } catch (error) {
        input.setAttribute('aria-invalid', 'true');
        errors.push(`${field.path}: ${error.message}`);
      }
    }
    if (errors.length) {
      const error = new Error('Some settings could not be read.');
      error.errors = errors;
      throw error;
    }
    return config;
  }

  markErrors(errors) {
    if (this.calendar && errors.some(error => [...CALENDAR_FIELDS, 'boundaries'].some(path => error.startsWith(`${path}:`) || error.startsWith(`${path}[`)))) {
      this.calendar.container.setAttribute('aria-invalid', 'true');
      this.calendar.container.closest('details').open = true;
    }
    for (const [path, {input}] of this.inputs) {
      if (errors.some(error => error.startsWith(`${path}:`) || error.startsWith(`${path}[`))) {
        input.setAttribute('aria-invalid', 'true');
        input.closest('details').open = true;
      }
    }
  }
}
