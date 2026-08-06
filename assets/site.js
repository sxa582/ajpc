(() => {
  'use strict';

  const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);

  const articleURL = article => `article.html?pmcid=${encodeURIComponent(article.pmcid)}`;
  const abstractText = article => article.abstractText || article.summary || 'An abstract is not available in the local article index.';
  const abstractId = (article, context) => `${context}-abstract-${String(article.pmcid || article.doi || article.title).replace(/[^a-z0-9_-]/gi, '-')}`;
  const dateLabel = value => {
    if (!value) return 'Recently published';
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    }).format(date);
  };

  const searchToggle = document.getElementById('searchToggle');
  const searchPanel = document.getElementById('searchPanel');
  if (searchToggle && searchPanel) {
    searchToggle.addEventListener('click', () => {
      const isOpen = searchPanel.classList.toggle('open');
      searchToggle.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) searchPanel.querySelector('input')?.focus();
    });
  }

  let articleIndex = [];

  function renderFeatured(article) {
    const featured = document.getElementById('featuredArticle');
    if (!featured || !article) return;
    featured.innerHTML = `
      <div class="lead-copy">
        <div class="kicker">${escapeHTML(article.articleType || 'Featured open-access article')}</div>
        <h1>${escapeHTML(article.title)}</h1>
        <p>${escapeHTML(article.summary || article.abstractText || '')}</p>
        <div class="article-meta">
          <span><strong>${escapeHTML(article.authorsShort || '')}</strong></span>
          <span>Published ${escapeHTML(dateLabel(article.published))}</span>
          <span>${article.volume ? `Volume ${escapeHTML(article.volume)}` : ''}${article.articleNumber ? ` · Article ${escapeHTML(article.articleNumber)}` : ''}</span>
          <span>${escapeHTML(article.license || 'Open access')}</span>
        </div>
        <div class="lead-actions">
          <a class="btn btn-accent" href="${articleURL(article)}">Read on AJPC</a>
          <a class="btn btn-outline" href="#library">Browse all articles</a>
        </div>
      </div>`;
  }

  function renderCurrentIssue(data) {
    const container = document.getElementById('currentIssueThemes');
    const label = document.getElementById('currentIssueLabel');
    const volumeLabel = document.getElementById('volumeLabel');
    if (!container || !Array.isArray(data.articles)) return;
    if (data.currentVolume) {
      if (label) label.textContent = `Volume ${data.currentVolume}`;
      if (volumeLabel) volumeLabel.textContent = `Volume ${data.currentVolume}`;
    }
    const issueArticles = data.currentVolume ? data.articles.filter(article => String(article.volume || '') === String(data.currentVolume)) : data.articles;
    const themes = data.themeOrder?.length ? data.themeOrder : [...new Set(issueArticles.map(a => a.theme).filter(Boolean))];
    const visibleThemes = themes.length ? themes : ['Current issue papers'];
    container.innerHTML = visibleThemes.map(theme => {
      const papers = issueArticles.filter(article => (article.theme || 'Current issue papers') === theme);
      if (!papers.length) return '';
      return `<section class="theme-section">
        <div class="theme-heading"><h3>${escapeHTML(theme)}</h3><span>${papers.length} ${papers.length === 1 ? 'paper' : 'papers'}</span></div>
        <div class="theme-list">${papers.map(article => {
          const panelId = abstractId(article, 'issue');
          return `
          <article class="theme-paper">
            <h4 class="paper-title"><button class="article-title-toggle" type="button" data-abstract-target="${escapeHTML(panelId)}" aria-expanded="false" aria-controls="${escapeHTML(panelId)}">${escapeHTML(article.title)}</button></h4>
            <div class="paper-byline"><strong>${escapeHTML(article.authorsShort || '')}</strong>${escapeHTML(dateLabel(article.published))}</div>
            <span class="paper-arrow" aria-hidden="true">+</span>
            <div class="abstract-preview paper-abstract" id="${escapeHTML(panelId)}" hidden>
              <div class="kicker">Abstract</div>
              <p>${escapeHTML(abstractText(article))}</p>
              <a class="library-link" href="${articleURL(article)}">Open full text on AJPC →</a>
            </div>
          </article>`;
        }).join('')}</div>
      </section>`;
    }).join('') || '<p class="feed-status">No current issue articles are indexed yet.</p>';
  }

  function renderLibrary() {
    const grid = document.getElementById('libraryGrid');
    const count = document.getElementById('libraryCount');
    const search = (document.getElementById('librarySearch')?.value || '').trim().toLowerCase();
    const topic = document.getElementById('topicFilter')?.value || '';
    if (!grid) return;
    const filtered = articleIndex.filter(article => {
      const haystack = [article.title, article.authorsShort, article.theme, article.doi, article.pmcid, article.summary]
        .filter(Boolean).join(' ').toLowerCase();
      return (!search || haystack.includes(search)) && (!topic || article.theme === topic);
    });
    if (count) count.textContent = `${filtered.length} ${filtered.length === 1 ? 'article' : 'articles'}`;
    grid.innerHTML = filtered.length ? filtered.map(article => {
      const panelId = abstractId(article, 'library');
      return `
      <article class="library-card">
        <div class="kicker">${escapeHTML(article.theme || article.articleType || 'Article')}</div>
        <h3><button class="article-title-toggle" type="button" data-abstract-target="${escapeHTML(panelId)}" aria-expanded="false" aria-controls="${escapeHTML(panelId)}">${escapeHTML(article.title)}</button></h3>
        <div class="library-meta">${escapeHTML(article.authorsShort || '')}<br>${escapeHTML(dateLabel(article.published))} · ${escapeHTML(article.license || 'Open access')}</div>
        <div class="abstract-preview library-abstract" id="${escapeHTML(panelId)}" hidden>
          <div class="kicker">Abstract</div>
          <p>${escapeHTML(abstractText(article))}</p>
        </div>
        <div class="library-actions">
          <button class="abstract-toggle-link" type="button" data-abstract-target="${escapeHTML(panelId)}" aria-expanded="false" aria-controls="${escapeHTML(panelId)}">Show abstract</button>
          <a class="library-link" href="${articleURL(article)}">Open full text on AJPC →</a>
        </div>
      </article>`;
    }).join('') : '<div class="empty-state">No articles match this search.</div>';
  }

  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-abstract-target]');
    if (!toggle) return;
    const panelId = toggle.dataset.abstractTarget;
    const panel = panelId ? document.getElementById(panelId) : null;
    if (!panel) return;
    const expanded = panel.hidden;
    panel.hidden = !expanded;
    const article = toggle.closest('article');
    article?.classList.toggle('abstract-open', expanded);
    article?.querySelectorAll(`[data-abstract-target="${CSS.escape(panelId)}"]`).forEach(control => {
      control.setAttribute('aria-expanded', String(expanded));
      if (control.classList.contains('abstract-toggle-link')) control.textContent = expanded ? 'Hide abstract' : 'Show abstract';
    });
  });

  function populateTopics() {
    const select = document.getElementById('topicFilter');
    if (!select) return;
    const topics = [...new Set(articleIndex.map(a => a.theme).filter(Boolean))].sort();
    topics.forEach(topic => {
      const option = document.createElement('option');
      option.value = topic;
      option.textContent = topic;
      select.appendChild(option);
    });
  }

  document.getElementById('librarySearch')?.addEventListener('input', renderLibrary);
  document.getElementById('topicFilter')?.addEventListener('change', renderLibrary);
  document.querySelectorAll('[data-topic]').forEach(link => link.addEventListener('click', () => {
    const select = document.getElementById('topicFilter');
    if (select) select.value = link.dataset.topic || '';
    renderLibrary();
  }));

  document.getElementById('globalSearch')?.addEventListener('submit', event => {
    event.preventDefault();
    const value = document.getElementById('globalSearchInput')?.value || '';
    const librarySearch = document.getElementById('librarySearch');
    if (librarySearch) librarySearch.value = value;
    renderLibrary();
    document.getElementById('library')?.scrollIntoView({ behavior: 'smooth' });
  });

  fetch('data/articles.json', { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`Article index returned ${response.status}`);
      return response.json();
    })
    .then(data => {
      articleIndex = Array.isArray(data.articles) ? data.articles : [];
      renderFeatured(articleIndex.find(a => a.featured) || articleIndex[0]);
      renderCurrentIssue(data);
      populateTopics();
      renderLibrary();
    })
    .catch(error => {
      console.error(error);
      const featured = document.getElementById('featuredArticle');
      const issue = document.getElementById('currentIssueThemes');
      const grid = document.getElementById('libraryGrid');
      if (featured) featured.innerHTML = '<div class="error-reader">The local article index could not be loaded. Serve this folder through a web server rather than opening the HTML file directly.</div>';
      if (issue) issue.innerHTML = '<p class="feed-status">Article feed unavailable.</p>';
      if (grid) grid.innerHTML = '<div class="empty-state">Article library unavailable.</div>';
    });
})();
