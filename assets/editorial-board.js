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
    const excerpt = source.slice(start, end > start ? end : undefined)
      .replace(/^(Editor-in-Chief|Executive Editors|Associate Editors|Editorial Board Members)\r?$/gm, heading => `\n\n${heading}\n\n`);
    const blocks = excerpt.split(/\r?\n[ \t]*\r?\n/).map(item => item.trim()).filter(Boolean);
    const parsed = [];
    let role = '';
    for (let index = 0; index < blocks.length;) {
      const block = blocks[index];
      if (roles.has(block)) { role = block; index += 1; continue; }
      const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (!role || !looksLikeName(lines[0] || '')) { index += 1; continue; }
      const possibleExpertise = blocks[index + 1] || '';
      const nextFirstLine = possibleExpertise.split(/\r?\n/)[0].trim();
      const hasExpertise = possibleExpertise && !roles.has(possibleExpertise) && !looksLikeName(nextFirstLine);
      parsed.push({
        role,
        name: lines[0],
        affiliation: lines.slice(1).join(' '),
        expertise: hasExpertise ? possibleExpertise.replace(/\s+/g, ' ') : ''
      });
      index += hasExpertise ? 2 : 1;
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
