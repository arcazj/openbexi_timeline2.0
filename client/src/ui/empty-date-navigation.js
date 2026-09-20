// Empty-window hints have their own lifetime: a late source/range response cannot
// move the viewport or replace a newer query's message.
export function mountEmptyDateNavigation(container, { provider, input, generation, sourceLabel, dateLabel, current, navigate, onError, onGenerationChanged }) {
  let active = true, pending = null;
  const area = document.createElement('div'); area.className = 'empty-date-navigation'; container.append(area);
  const valid = () => active && container.isConnected && current();
  const text = (tag, value) => { const node = document.createElement(tag); node.textContent = value; return node; };
  const retry = () => {
    const button = text('button', 'Refresh available dates'); button.type = 'button';
    button.onclick = event => { event.stopPropagation(); if (valid()) load(); };
    area.append(button);
  };
  area.addEventListener('pointerdown', event => event.stopPropagation());
  async function load() {
    pending?.abort(); pending = new AbortController();
    area.replaceChildren(text('span', 'Checking available dates…'));
    try {
      const result = await provider.getDateAvailability(input, { signal: pending.signal });
      if (!valid()) return;
      if (result.generation !== generation) { area.replaceChildren(); onGenerationChanged(); return; }
      area.replaceChildren();
      const list = document.createElement('ul'); list.setAttribute('aria-label', 'Available dates by source');
      for (const source of result.sources) {
        const dates = source.first ? `${dateLabel(source.first)} – ${source.ongoing ? 'ongoing' : dateLabel(source.last)}` : result.complete ? 'no recorded dates' : 'no dates indexed yet';
        list.append(text('li', `${sourceLabel(source.sourceId)}: ${dates}`));
      }
      if (list.children.length) area.append(list);
      else area.append(text('span', 'No sources selected.'));
      const actions = document.createElement('div'); actions.className = 'empty-date-actions';
      for (const [key, label] of [['previous', 'Previous date with data'], ['next', 'Next date with data']]) {
        const button = text('button', label); button.type = 'button'; button.disabled = !result[key];
        if (result[key]) button.title = dateLabel(result[key]);
        button.onclick = event => { event.stopPropagation(); if (valid() && result[key]) navigate(result[key]); };
        actions.append(button);
      }
      area.append(actions, text('small', 'Dates reflect selected sources. Your other filters and search still apply.'));
      if (!result.complete) {
        area.append(text('small', 'Archive dates are still being indexed; additional dates may become available.')); retry();
      }
    } catch (error) {
      if (!valid() || error.name === 'AbortError') return;
      if ([401, 403].includes(error.status) || error.code === 'permission_scope_changed') { area.replaceChildren(); onError(error); return; }
      area.replaceChildren(text('span', 'Available dates could not be checked.')); retry();
    }
  }
  load();
  return () => { active = false; pending?.abort(); area.remove(); };
}
