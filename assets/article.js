(() => {
  'use strict';

  const root = document.getElementById('readerRoot');
  const params = new URLSearchParams(window.location.search);
  const pmcid = (params.get('pmcid') || '').toUpperCase();
  const allowedTags = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'SUB', 'SUP', 'SPAN', 'BR']);

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function sanitizeHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    const walk = node => {
      [...node.childNodes].forEach(child => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          if (!allowedTags.has(child.tagName)) {
            child.replaceWith(...child.childNodes);
            return;
          }
          [...child.attributes].forEach(attribute => {
            if (child.tagName === 'A' && attribute.name === 'href') {
              try {
                const url = new URL(attribute.value, window.location.origin);
                if (!['http:', 'https:'].includes(url.protocol)) child.removeAttribute('href');
              } catch { child.removeAttribute('href'); }
            } else if (!(child.tagName === 'SPAN' && attribute.name === 'class')) {
              child.removeAttribute(attribute.name);
            }
          });
          if (child.tagName === 'A') {
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener noreferrer');
          }
          walk(child);
        }
      });
    };
    walk(template.content);
    return template.innerHTML;
  }

  const slugify = (value, index) => {
    const slug = String(value || `section-${index + 1}`).toLowerCase()
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${slug || 'section'}-${index + 1}`;
  };

  function blockHTML(block) {
    if (!block || !block.type) return '';
    if (block.type === 'paragraph') return `<p>${sanitizeHTML(block.html || escapeHTML(block.text || ''))}</p>`;
    if (block.type === 'heading') return `<h3>${escapeHTML(block.text || '')}</h3>`;
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${(block.items || []).map(item => `<li>${sanitizeHTML(item)}</li>`).join('')}</${tag}>`;
    }
    if (block.type === 'quote') return `<blockquote class="article-quote">${sanitizeHTML(block.html || block.text || '')}</blockquote>`;
    if (block.type === 'figure') {
      const image = block.src ? `<img src="${escapeHTML(block.src)}" alt="${escapeHTML(block.alt || block.label || 'Article figure')}" loading="lazy" />` : '';
      return `<figure class="article-figure">${image}<figcaption>${block.label ? `<strong>${escapeHTML(block.label)}.</strong> ` : ''}${sanitizeHTML(block.caption || '')}</figcaption></figure>`;
    }
    if (block.type === 'table') return `<div class="article-table-wrap">${block.label ? `<div style="padding:12px;font-weight:800">${escapeHTML(block.label)}</div>` : ''}${block.html || ''}${block.caption ? `<div style="padding:12px;color:var(--muted);font-size:.74rem">${sanitizeHTML(block.caption)}</div>` : ''}</div>`;
    return '';
  }

  function sectionHTML(section, index) {
    const id = slugify(section.title, index);
    return `<section class="article-section" id="${id}">
      <h2>${escapeHTML(section.title || `Section ${index + 1}`)}</h2>
      ${(section.blocks || []).map(blockHTML).join('')}
    </section>`;
  }

  function citationText(article) {
    const authors = (article.authors || []).map(author => author.display || [author.given, author.surname].filter(Boolean).join(' ')).filter(Boolean).join(', ');
    const journalBits = [article.journal, article.year || String(article.published || '').slice(0, 4), article.volume ? `${article.volume}:${article.articleNumber || ''}` : article.articleNumber].filter(Boolean).join('. ');
    return `${authors}. ${article.title}. ${journalBits}. doi:${article.doi || ''}`.replace(/\s+/g, ' ').trim();
  }

  function render(article, podcast) {
    document.title = `${article.title} | AJPC`;
    const sections = Array.isArray(article.sections) ? article.sections : [];
    const toc = [
      ...(article.abstract?.length ? [{ title: 'Abstract', id: 'abstract' }] : []),
      ...sections.map((section, index) => ({ title: section.title || `Section ${index + 1}`, id: slugify(section.title, index) })),
      ...(article.references?.length ? [{ title: 'References', id: 'references' }] : [])
    ];
    const abstract = (article.abstract || []).map(item => `<p>${sanitizeHTML(item.html || item.text || item)}</p>`).join('');
    const references = (article.references || []).length ? `<section class="article-section" id="references"><h2>References</h2><ol class="reference-list">${article.references.map(ref => `<li>${sanitizeHTML(ref.html || ref.text || ref)}</li>`).join('')}</ol></section>` : '';
    const notice = article.notice ? `<div class="article-license" style="border-left-color:var(--accent);background:#fff1f4;color:#6f2232"><strong>Prototype note:</strong> ${escapeHTML(article.notice)}</div>` : '';
    const licenseURL = article.licenseUrl || 'https://creativecommons.org/licenses/by/4.0/';
    const authors = (article.authors || []).map(author => escapeHTML(author.display || [author.given, author.surname].filter(Boolean).join(' '))).join(', ');
    const podcastCard = podcast ? `<div class="article-podcast-card">
      <div class="article-podcast-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 0 1 14 0v5a2 2 0 0 1-2 2h-2v-6h3v-1a6 6 0 0 0-12 0v1h3v6H7a2 2 0 0 1-2-2v-5Z"/></svg></div>
      <div class="article-podcast-copy"><strong>${escapeHTML(podcast.title || 'AJPC Briefing')}</strong><span>${escapeHTML(podcast.description || 'Listen to a concise audio briefing for this article.')} ${escapeHTML(podcast.duration || '')}</span></div>
      <audio controls preload="metadata" src="${escapeHTML(podcast.audio)}">Your browser does not support audio playback.</audio>
      <a href="${escapeHTML(podcast.audio)}" download>Download MP3</a>
    </div>` : '';

    root.innerHTML = `
      <section class="article-hero">
        <div class="container">
          <div class="article-type">${escapeHTML(article.articleType || 'Open-access article')}</div>
          <h1>${escapeHTML(article.title)}</h1>
          <div class="article-authors">${authors}</div>
          <div class="article-citation-row">
            <span>${escapeHTML(article.journal || 'American Journal of Preventive Cardiology')}</span>
            <span>${article.published ? `Published ${escapeHTML(article.published)}` : ''}</span>
            <span>${article.volume ? `Volume ${escapeHTML(article.volume)}` : ''}${article.articleNumber ? ` · ${escapeHTML(article.articleNumber)}` : ''}</span>
            <span>${escapeHTML(article.pmcid || '')}</span>
          </div>
          <div class="article-license"><strong>${escapeHTML(article.license || 'CC BY 4.0')}.</strong> © ${escapeHTML(article.copyright || 'The Authors')}. This article may be shared and adapted with appropriate attribution. <a href="${escapeHTML(licenseURL)}" target="_blank" rel="noopener noreferrer"><u>View license</u></a>. The article has been reformatted for display on the AJPC website; scientific content is not intentionally altered.</div>
          ${podcastCard}
          ${notice}
        </div>
      </section>
      <div class="container reader-shell">
        <nav class="reader-toc" aria-label="Article contents">
          <h2>In this article</h2>
          <ol>${toc.map(item => `<li><a href="#${item.id}">${escapeHTML(item.title)}</a></li>`).join('')}</ol>
        </nav>
        <article class="article-body" id="articleBody">
          ${abstract ? `<section class="abstract-box article-section" id="abstract"><h2>Abstract</h2>${abstract}</section>` : ''}
          ${sections.map(sectionHTML).join('')}
          ${references}
        </article>
        <aside class="reader-aside">
          <div class="aside-card"><h2>Article information</h2><p><strong>DOI</strong><br>${escapeHTML(article.doi || 'Not supplied')}</p><p><strong>PMCID</strong><br>${escapeHTML(article.pmcid || 'Not supplied')}</p><p><strong>License</strong><br>${escapeHTML(article.license || 'Open access')}</p></div>
          <div class="aside-card"><h2>Keywords</h2><p>${(article.keywords || []).map(escapeHTML).join(' · ') || 'Not supplied'}</p></div>
          <div class="aside-card"><h2>Original source</h2><p>This reading page is generated from the article’s structured PMC/JATS record. Use the source links for provenance and version checking.</p><p><a id="pmcSource" class="text-link" href="${escapeHTML(article.pmcUrl || '#')}" target="_blank" rel="noopener noreferrer">View PMC record →</a></p></div>
        </aside>
      </div>`;

    const doiURL = article.doi ? `https://doi.org/${article.doi}` : '#';
    document.getElementById('doiLink').href = doiURL;
    document.getElementById('doiLinkFooter').href = doiURL;
    document.getElementById('pmcLinkFooter').href = article.pmcUrl || '#';
    document.getElementById('copyCitation').onclick = async () => {
      const text = citationText(article);
      try {
        await navigator.clipboard.writeText(text);
        document.getElementById('copyCitation').textContent = 'Copied';
        setTimeout(() => { document.getElementById('copyCitation').textContent = 'Copy citation'; }, 1400);
      } catch {
        window.prompt('Copy this citation:', text);
      }
    };
    document.getElementById('printArticle').onclick = () => window.print();

    const links = [...document.querySelectorAll('.reader-toc a')];
    const observed = [...document.querySelectorAll('.article-section')];
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        links.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`));
      }, { rootMargin: '-15% 0px -70% 0px', threshold: [0, .2, .6] });
      observed.forEach(section => observer.observe(section));
    }
  }

  if (!/^PMC\d+$/.test(pmcid)) {
    root.innerHTML = '<div class="container loading-reader"><div class="error-reader">No valid PMCID was supplied. Return to the <a href="index.html"><u>AJPC article library</u></a>.</div></div>';
    return;
  }

  Promise.all([
    fetch(`data/articles/${encodeURIComponent(pmcid)}.json`, { cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error(`Article file returned ${response.status}`);
      return response.json();
    }),
    fetch('data/podcasts.json', { cache: 'no-store' }).then(response => response.ok ? response.json() : {}).catch(() => ({}))
  ])
    .then(([article, podcasts]) => render(article, podcasts[pmcid]))
    .catch(error => {
      console.error(error);
      root.innerHTML = `<div class="container loading-reader"><div class="error-reader"><strong>This article has not been imported yet.</strong><br>Run <code>python scripts/sync_ajpc.py</code> to retrieve eligible CC BY full text from PMC, then reload this page.</div></div>`;
    });
})();
