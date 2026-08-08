(() => {
  const roles = new Set(['Editor-in-Chief', 'Executive Editors', 'Associate Editors', 'Editorial Board Members']);
  const boardRoot = document.getElementById('boardSections');
  const searchInput = document.getElementById('boardSearch');
  const count = document.getElementById('boardCount');
  let people = [];

  const escapeHTML = value => String(value || '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
  const looksLikeName = value => /(?:^|,\s*)(?:MD|DO|PhD|MPH|MSc|MS|MHS|BSN|DMSc|DSc|Professor)\b/i.test(value);

  function parseBoard(source) {
    const start = source.indexOf('Editor-in-Chief');
    const end = source.indexOf('All members of the Editorial Board');
    const excerpt = source.slice(start, end > start ? end : undefined);
    const blocks = excerpt.split(/\r?\n\s*\r?\n/).map(item => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const parsed = [];
    let role = '';
    for (let index = 0; index < blocks.length;) {
      const block = blocks[index];
      if (roles.has(block)) { role = block; index += 1; continue; }
      if (!role || !looksLikeName(block)) { index += 1; continue; }
      const affiliation = blocks[index + 1] && !roles.has(blocks[index + 1]) ? blocks[index + 1] : '';
      const possibleExpertise = blocks[index + 2] || '';
      const hasExpertise = possibleExpertise && !roles.has(possibleExpertise) && !looksLikeName(possibleExpertise);
      parsed.push({ role, name: block, affiliation, expertise: hasExpertise ? possibleExpertise : '' });
      index += hasExpertise ? 3 : 2;
    }
    return parsed;
  }

  function render() {
    const query = (searchInput?.value || '').trim().toLowerCase();
    const filtered = people.filter(person => !query || [person.name, person.affiliation, person.expertise, person.role].join(' ').toLowerCase().includes(query));
    count.textContent = `${filtered.length} ${filtered.length === 1 ? 'member' : 'members'}`;
    boardRoot.innerHTML = [...roles].map(role => {
      const members = filtered.filter(person => person.role === role);
      if (!members.length) return '';
      return `<section class="board-group">
        <div class="board-group-heading"><h2>${escapeHTML(role)}</h2><span>${members.length}</span></div>
        <div class="board-grid">${members.map(person => `<article class="board-card">
          <h3>${escapeHTML(person.name)}</h3>
          <p class="board-affiliation">${escapeHTML(person.affiliation)}</p>
          ${person.expertise ? `<p class="board-expertise">${escapeHTML(person.expertise)}</p>` : ''}
        </article>`).join('')}</div>
      </section>`;
    }).join('') || '<p class="board-empty">No editorial board members match your search.</p>';
  }

  fetch('assets/editorial-board-source.txt')
    .then(response => { if (!response.ok) throw new Error('Board data could not be loaded.'); return response.text(); })
    .then(source => { people = parseBoard(source); render(); })
    .catch(() => { boardRoot.innerHTML = '<p class="board-empty">Editorial board information is temporarily unavailable.</p>'; });

  searchInput?.addEventListener('input', render);
})();
