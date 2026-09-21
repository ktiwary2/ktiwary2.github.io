function applySimpleTheme(theme) {
    document.body.classList.toggle('dark-mode', theme === 'dark');
    document.querySelectorAll('.theme-toggle').forEach(function(button) {
        button.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
        button.setAttribute('aria-pressed', String(theme === 'dark'));
    });
}

document.addEventListener('DOMContentLoaded', function() {
    let savedTheme;
    try {
        savedTheme = localStorage.getItem('preferred-theme');
    } catch (error) {
        savedTheme = null;
    }
    applySimpleTheme(savedTheme || 'light');

    document.querySelectorAll('.theme-toggle').forEach(function(button) {
        button.addEventListener('click', function() {
            const theme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
            applySimpleTheme(theme);
            try {
                localStorage.setItem('preferred-theme', theme);
            } catch (error) {}
        });
    });

    initializeSiteTabs();
});

window.addEventListener('storage', function(event) {
    if (event.key === 'preferred-theme') {
        applySimpleTheme(event.newValue || 'light');
    }
});

function initializeSiteTabs() {
    const main = document.querySelector('main.page-content');
    const navigation = document.querySelector('.site-nav');
    if (!main || !navigation) return;

    const tabs = [...navigation.querySelectorAll('[data-view]')];
    const categories = {
        'computer-vision': 'cv-tag',
        discovery: 'ai-tag',
        patents: 'patent-tag',
        perspective: 'perspective-tag',
        workshops: 'workshop-tag',
        exhibitions: 'exhibition-tag'
    };
    const aliases = {
        'research-section': 'computer-vision',
        'publications-section': 'computer-vision',
        publications: 'computer-vision',
        'writings-section': 'writings',
        'news-section': 'news'
    };
    const defaultView = main.dataset.defaultView;
    const initialTab = tabs.find(tab => tab.dataset.view === defaultView);
    const cache = new Map([[new URL(initialTab.href).pathname, Promise.resolve(main.cloneNode(true))]]);
    const panel = document.createElement('div');
    panel.id = 'tab-content';
    panel.setAttribute('role', 'tabpanel');
    panel.tabIndex = 0;
    panel.append(...main.childNodes);
    main.append(panel);

    const status = document.createElement('p');
    status.className = 'tab-status';
    status.setAttribute('role', 'status');
    status.hidden = true;
    main.before(status);

    navigation.setAttribute('role', 'tablist');
    tabs.forEach(tab => {
        tab.id = 'tab-' + tab.dataset.view;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', panel.id);
        tab.setAttribute('aria-selected', String(tab === initialTab));
        tab.tabIndex = tab === initialTab ? 0 : -1;
    });

    let requestId = 0;
    let activeView = defaultView;

    function requestedView() {
        const hash = location.hash.slice(1);
        const view = aliases[hash] || hash;
        return tabs.some(tab => tab.dataset.view === view) ? view : defaultView;
    }

    async function loadContent(tab) {
        const url = new URL(tab.href);
        const key = url.pathname;
        if (!cache.has(key)) {
            cache.set(key, fetch(url.pathname).then(response => {
                if (!response.ok) throw new Error('Unable to load content');
                return response.text();
            }).then(html => {
                const source = new DOMParser().parseFromString(html, 'text/html').querySelector('main.page-content');
                if (!source) throw new Error('Missing page content');
                source.querySelectorAll('script, .contact-links').forEach(element => element.remove());
                return source;
            }).catch(error => {
                cache.delete(key);
                throw error;
            }));
        }
        return cache.get(key);
    }

    function filterNews(tag) {
        panel.querySelectorAll('.news-item').forEach(item => {
            item.hidden = tag !== 'all' && !item.classList.contains(tag) && !item.querySelector('.' + tag);
        });
        panel.querySelectorAll('[data-news-filter]').forEach(button => {
            const active = button.dataset.newsFilter === tag;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });
    }

    async function populateRecentNews() {
        const container = panel.querySelector('#about-recent-news');
        if (!container) return;
        try {
            const newsTab = tabs.find(tab => tab.dataset.view === 'news');
            const source = await loadContent(newsTab);
            if (!container.isConnected) return;
            container.replaceChildren(...[...source.querySelectorAll('.news-item.recent-news')].map(item => {
                const entry = item.cloneNode(true);
                entry.hidden = false;
                return entry;
            }));
        } catch (error) {
            if (container.isConnected) container.textContent = 'Recent updates could not load. View all news below.';
        }
    }

    async function selectView(view, updateHistory = false) {
        const tab = tabs.find(candidate => candidate.dataset.view === view);
        if (!tab) return;
        const currentRequest = ++requestId;
        panel.setAttribute('aria-busy', 'true');
        status.textContent = 'Loading ' + tab.textContent + '…';
        status.hidden = false;

        try {
            const source = await loadContent(tab);
            if (currentRequest !== requestId) return;

            panel.querySelectorAll('video, audio').forEach(media => media.pause());
            panel.replaceChildren(...[...source.childNodes].map(node => node.cloneNode(true)));
            main.classList.toggle('news-container', view === 'news');
            document.body.classList.toggle('home-page', view === 'about');

            if (categories[view]) {
                panel.querySelector('h1').textContent = tab.textContent;
                panel.querySelectorAll('.publication-entry').forEach(entry => {
                    entry.hidden = !entry.querySelector('.' + categories[view]);
                });
            }
            if (view === 'news') filterNews('recent-news');
            if (view === 'about') populateRecentNews();

            tabs.forEach(candidate => {
                const selected = candidate === tab;
                candidate.setAttribute('aria-selected', String(selected));
                candidate.tabIndex = selected ? 0 : -1;
                if (selected) candidate.setAttribute('aria-current', 'page');
                else candidate.removeAttribute('aria-current');
            });
            panel.setAttribute('aria-labelledby', tab.id);
            document.title = view === 'about' ? 'Kushagra Tiwary' : tab.textContent + ' – Kushagra Tiwary';
            if (updateHistory && location.hash !== '#' + view) {
                history.pushState(null, '', '#' + view);
            }
            activeView = view;
            status.hidden = true;
        } catch (error) {
            if (currentRequest !== requestId) return;
            status.textContent = 'Could not load ' + tab.textContent + '. Please select the tab to try again.';
        } finally {
            if (currentRequest === requestId) panel.setAttribute('aria-busy', 'false');
        }
    }

    navigation.addEventListener('click', event => {
        const tab = event.target.closest('[data-view]');
        if (!tab || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        selectView(tab.dataset.view, true);
    });

    navigation.addEventListener('keydown', event => {
        const index = tabs.indexOf(event.target);
        if (index < 0) return;
        let nextIndex;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (index + tabs.length - 1) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        else if (event.key === ' ') {
            event.preventDefault();
            selectView(tabs[index].dataset.view, true);
            return;
        } else return;
        event.preventDefault();
        tabs[nextIndex].focus();
    });

    panel.addEventListener('click', event => {
        const filter = event.target.closest('[data-news-filter]');
        if (filter) filterNews(filter.dataset.newsFilter);
        const viewLink = event.target.closest('[data-open-view]');
        if (viewLink && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            selectView(viewLink.dataset.openView, true);
        }
        const homeLink = event.target.closest('.site-footer a[href="index.html"]');
        if (homeLink && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            selectView('about', true);
        }
    });

    function restoreView() {
        const view = requestedView();
        if (view !== activeView || panel.getAttribute('aria-busy') === 'true') selectView(view);
    }
    window.addEventListener('popstate', restoreView);
    window.addEventListener('hashchange', restoreView);
    selectView(requestedView());
}
