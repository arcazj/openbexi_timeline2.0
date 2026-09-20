import { filterFieldLabel } from './filter-editor-state.js';

export function mountFilterGrouping(parent, { fieldTypes = {}, groupingFields, grouping = null, groupOrder, definitionVersion = 1, onChange } = {}) {
  const container = document.createElement('fieldset'); container.className = 'filter-grouping';
  container.innerHTML = '<legend>Grouping</legend><div class="filter-grouping-fields"><label>Field<select aria-label="Group by field"></select></label><label>Direction<select aria-label="Group direction"><option value="asc">Ascending</option><option value="desc">Descending</option></select></label><label>Text order<select aria-label="Group text order"><option value="codepoint">Code point</option><option value="natural">Natural</option></select></label><label class="check-label"><input type="checkbox" aria-label="Case-sensitive groups">Case-sensitive</label><label>Group order<select aria-label="Group order"><option value="value">By value</option><option value="encounter">First encounter</option></select></label><label>Activities<select aria-label="Activity grouping"><option value="independent">Own value</option><option value="parent-family">Parent family</option></select></label></div>';
  parent.append(container);
  const [field, direction, order, encounter, policy] = container.querySelectorAll('select'), sensitive = container.querySelector('input');
  const fields = () => {
    field.replaceChildren(new Option('All records', ''));
    const seen = new Set();
    for (const item of groupingFields?.fields ?? []) { field.add(new Option(item.label, item.path)); seen.add(item.path); }
    for (const [path, type] of Object.entries(fieldTypes)) if (type !== 'strings' && !seen.has(path)) field.add(new Option(filterFieldLabel(path), path));
  };
  fields();
  let version = definitionVersion;
  const enabled = () => {
    container.disabled = version !== 2;
    direction.disabled = !field.value || encounter.value === 'encounter';
    order.disabled = sensitive.disabled = !field.value || encounter.value === 'encounter' || fieldTypes[field.value] !== 'string';
    policy.disabled = encounter.disabled = !field.value;
  };
  const reset = value => {
    if (value.grouping?.field && ![...field.options].some(option => option.value === value.grouping.field)) field.add(new Option(`${filterFieldLabel(value.grouping.field)} (undeclared)`, value.grouping.field));
    field.value = value.grouping?.field ?? ''; direction.value = value.grouping?.direction ?? 'asc';
    encounter.value = value.grouping?.order ?? 'value'; policy.value = value.grouping?.recordPolicy ?? 'independent';
    order.value = value.groupOrder?.order ?? 'codepoint'; sensitive.checked = value.groupOrder?.caseSensitive ?? true; enabled();
  };
  reset({ grouping, groupOrder });
  container.addEventListener('change', event => { if (event.target === field && fieldTypes[field.value] !== 'string') { order.value = 'codepoint'; sensitive.checked = true; } enabled(); onChange?.(); });
  return {
    setVersion(value) { version = value; enabled(); }, reset,
    setFieldTypes(registry) {
      const selected = field.value; fieldTypes = registry; fields();
      if (selected && ![...field.options].some(option => option.value === selected)) field.add(new Option(`${filterFieldLabel(selected)} (unavailable)`, selected));
      field.value = selected; enabled();
    },
    setGroupingFields(inventory) { groupingFields = inventory; this.setFieldTypes(fieldTypes); },
    value() { return { grouping: field.value ? { field: field.value, direction: direction.value, ...(policy.value !== 'independent' ? { recordPolicy: policy.value } : {}), ...(encounter.value !== 'value' ? { order: encounter.value } : {}) } : null, groupOrder: { order: order.value, caseSensitive: sensitive.checked } }; },
    dispose() { container.remove(); },
  };
}
