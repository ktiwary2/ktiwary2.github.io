/* global requestAnimationFrame */
(function () {
    'use strict';

    // Only the top-level page draws. Iframes forward pointer data through evolving_cursor.js.
    if (window.top !== window) return;

    const POINTER_MESSAGE = 'evolving-cursor:pointer';
    const MODES = ['life', 'evolve', 'off'];

    // Life-like rules. Every burst of motion after a pause starts a new colony under one of these.
    const RULES = [
        { name: 'Life',          code: 'B3/S23',         b: [3],             s: [2, 3] },
        { name: 'HighLife',      code: 'B36/S23',        b: [3, 6],          s: [2, 3] },
        { name: 'Day & Night',   code: 'B3678/S34678',   b: [3, 6, 7, 8],    s: [3, 4, 6, 7, 8] },
        { name: 'Maze',          code: 'B3/S12345',      b: [3],             s: [1, 2, 3, 4, 5] },
        { name: 'Mazectric',     code: 'B3/S1234',       b: [3],             s: [1, 2, 3, 4] },
        { name: 'Coral',         code: 'B3/S45678',      b: [3],             s: [4, 5, 6, 7, 8] },
        { name: 'Diamoeba',      code: 'B35678/S5678',   b: [3, 5, 6, 7, 8], s: [5, 6, 7, 8] },
        { name: '2x2',           code: 'B36/S125',       b: [3, 6],          s: [1, 2, 5] },
        { name: 'Anneal',        code: 'B4678/S35678',   b: [4, 6, 7, 8],    s: [3, 5, 6, 7, 8] },
        { name: 'Stains',        code: 'B3678/S235678',  b: [3, 6, 7, 8],    s: [2, 3, 5, 6, 7, 8] },
        { name: 'Walled Cities', code: 'B45678/S2345',   b: [4, 5, 6, 7, 8], s: [2, 3, 4, 5] },
        { name: 'Morley',        code: 'B368/S245',      b: [3, 6, 8],       s: [2, 4, 5] }
    ];
    const toMask = (list) => list.reduce((m, n) => m | (1 << n), 0);
    RULES.forEach((rule) => {
        rule.birth = toMask(rule.b);
        rule.survive = toMask(rule.s);
    });

    // Small seed patterns stamped along the pointer's path.
    const PATTERNS = [
        [[0, 1, 0], [0, 0, 1], [1, 1, 1]],          // glider
        [[0, 1, 1], [1, 1, 0], [0, 1, 0]],          // r-pentomino
        [[1, 1, 1]],                                // blinker
        [[1, 1], [1, 1]],                           // block
        [[0, 1, 1, 1], [1, 1, 1, 0]],               // toad
        [[1, 0, 1], [0, 1, 0], [1, 0, 1]]           // x
    ];

    const HUES = [12, 200, 34, 280, 150, 42];

    // The content column and the nav bar are cut out whole: cells, falling pieces and rule
    // labels only ever show in the margins beside the page. Anything else outside the column
    // (the cursor toggles) is cut out element by element.
    const COLUMN_SELECTOR = '.container, .top-nav';
    const COLUMN_PAD = 16;
    const OCCLUDER_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, dt, dd, .top-nav a, .cursor-toggle, .writings-label, '
        + '.news-name, .paper-name, .publication-tldr, .paper-status, .filter-menu, '
        + 'img, .video-facade, .hero-canvas-wrap, .profile-image-container';

    function rand(min, max) { return min + Math.random() * (max - min); }
    function choice(arr) { return arr[(Math.random() * arr.length) | 0]; }

    function readMode() {
        const fromBody = document.body && document.body.dataset.cursorMode;
        if (MODES.includes(fromBody)) return fromBody;
        try {
            const stored = localStorage.getItem('cursor-mode');
            if (MODES.includes(stored)) return stored;
        } catch (err) { /* storage unavailable */ }
        return 'life';
    }

    function init() {
        if (document.body.dataset.lifeCursorInitialized) return;
        document.body.dataset.lifeCursorInitialized = 'true';

        const canvas = document.createElement('canvas');
        canvas.id = 'life-canvas';
        canvas.className = 'cursor-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        // Colonies are drawn into this layer only when a generation ticks (or the page scrolls);
        // each frame just composites it, so dozens of colonies stay cheap.
        const layer = document.createElement('canvas');
        const lctx = layer.getContext('2d');

        const CELL = 10;
        const COLONY_CELLS = 64;         // each colony lives on its own 64x64 patch (640px square)
        const STEP_MS = 80;              // ~12 generations per second
        const LIFETIME_MS = 60000;       // a colony runs this long, then every cell drops
        const STOP_MS = 500;             // a pause this long means the next move starts a new colony
        const LABEL_MS = 1800;
        const MAX_COLONIES = 24;
        const MAX_DROPS = 2500;
        const GRAVITY = 0.42;
        const OCCLUDER_REFRESH_MS = 250;
        const OCCLUDER_PAD = 2;
        const MERGE_GAP = 10;            // blocks closer than this are treated as one

        const W = COLONY_CELLS + 2;      // one dead cell of padding on every side
        const SPAN = COLONY_CELLS * CELL;

        let width = 0, height = 0;
        function resize() {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            layer.width = canvas.width;
            layer.height = canvas.height;
            lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            occludersDirty = true;
            layerDirty = true;
        }

        const state = {
            x: 0, y: 0, vx: 0, vy: 0, targetX: 0, targetY: 0,
            angle: 0, speed: 0, time: 0,
            moved: false, lastMoveAt: 0,
            hue: 200
        };
        const colonies = [];             // oldest first
        let current = null;
        const drops = [];
        let occluders = [];
        let occludersDirty = true;
        let occludersAt = 0;
        let layerDirty = true;
        let layerScrollX = 0, layerScrollY = 0;
        let stepClock = 0;

        resize();
        window.addEventListener('resize', resize);
        window.addEventListener('scroll', () => { occludersDirty = true; }, { passive: true });

        let mode = readMode();
        function setMode(nextMode) {
            mode = nextMode;
            canvas.style.display = mode === 'life' ? '' : 'none';
            if (mode !== 'life') {
                colonies.length = 0;
                drops.length = 0;
                current = null;
                ctx.clearRect(0, 0, width, height);
                layerDirty = true;
            }
        }
        setMode(mode);
        window.addEventListener('cursor-mode-change', (event) => {
            if (event.detail && MODES.includes(event.detail.mode)) setMode(event.detail.mode);
        });

        function pointerTo(x, y) {
            // Chrome re-dispatches mousemove after scrolls and layout shifts; ignore those.
            if (Math.abs(x - state.targetX) < 0.5 && Math.abs(y - state.targetY) < 0.5) return;
            state.targetX = x;
            state.targetY = y;
            state.moved = true;
        }
        document.addEventListener('pointermove', (e) => pointerTo(e.clientX, e.clientY), { passive: true });
        window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data || data.type !== POINTER_MESSAGE || !data.frameId || data.leave) return;
            const iframe = document.querySelector(`iframe[name="${CSS.escape(data.frameId)}"]`);
            if (!iframe) return;
            const rect = iframe.getBoundingClientRect();
            pointerTo(rect.left + data.x, rect.top + data.y);
        });

        // ---- colonies -------------------------------------------------------------

        function newColony(now, pageX, pageY) {
            const colony = {
                rule: choice(RULES),
                hue: choice(HUES),
                ox: Math.round(pageX / CELL) * CELL - SPAN / 2,   // page coordinates of the patch
                oy: Math.round(pageY / CELL) * CELL - SPAN / 2,
                cells: new Uint8Array(W * W),
                next: new Uint8Array(W * W),
                born: new Uint32Array(W * W),
                generation: 0,
                endsAt: now + LIFETIME_MS,
                labelUntil: now + LABEL_MS,
                labelX: pageX,
                labelY: pageY,
                travel: 0
            };
            colonies.push(colony);
            current = colony;
            state.hue = colony.hue;
            layerDirty = true;
            if (colonies.length > MAX_COLONIES) dropColony(colonies[0], now);
            return colony;
        }

        function contains(colony, pageX, pageY) {
            return pageX >= colony.ox && pageX < colony.ox + SPAN && pageY >= colony.oy && pageY < colony.oy + SPAN;
        }

        function setCell(colony, col, row) {
            if (col < 0 || row < 0 || col >= COLONY_CELLS || row >= COLONY_CELLS) return;
            const idx = (row + 1) * W + (col + 1);
            if (!colony.cells[idx]) {
                colony.cells[idx] = 1;
                colony.born[idx] = colony.generation;
                layerDirty = true;
            }
        }

        function stamp(colony, col, row, pattern) {
            const h = pattern.length, w = pattern[0].length;
            for (let r = 0; r < h; r++) {
                for (let c = 0; c < w; c++) {
                    if (pattern[r][c]) setCell(colony, col + c - (w >> 1), row + r - (h >> 1));
                }
            }
        }

        function seed(colony, pageX, pageY) {
            const col = Math.floor((pageX - colony.ox) / CELL);
            const row = Math.floor((pageY - colony.oy) / CELL);
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (Math.random() < 0.45) setCell(colony, col + dx, row + dy);
                }
            }
            colony.travel += state.speed;
            if (colony.travel > 40) {
                colony.travel = 0;
                stamp(colony, col + (rand(-3, 3) | 0), row + (rand(-3, 3) | 0), choice(PATTERNS));
            }
        }

        function step(colony) {
            const { rule, cells, next, born } = colony;
            const gen = colony.generation + 1;
            next.fill(0);
            for (let r = 1; r < W - 1; r++) {
                const base = r * W;
                for (let c = 1; c < W - 1; c++) {
                    const idx = base + c;
                    const n = cells[idx - W - 1] + cells[idx - W] + cells[idx - W + 1]
                            + cells[idx - 1] + cells[idx + 1]
                            + cells[idx + W - 1] + cells[idx + W] + cells[idx + W + 1];
                    const alive = cells[idx];
                    const live = alive ? (rule.survive >> n) & 1 : (rule.birth >> n) & 1;
                    next[idx] = live;
                    if (live && !alive) born[idx] = gen;
                }
            }
            colony.cells = next;
            colony.next = cells;
            colony.generation = gen;
        }

        function dropColony(colony, now) {
            const alive = [];
            for (let r = 1; r < W - 1; r++) {
                const base = r * W;
                for (let c = 1; c < W - 1; c++) {
                    if (colony.cells[base + c]) alive.push(base + c);
                }
            }
            const room = Math.max(0, MAX_DROPS - drops.length);
            if (alive.length > room) {
                for (let i = alive.length - 1; i > 0; i--) {
                    const j = (Math.random() * (i + 1)) | 0;
                    const t = alive[i]; alive[i] = alive[j]; alive[j] = t;
                }
                alive.length = room;
            }
            alive.forEach((idx) => {
                const c = (idx % W) - 1;
                const r = Math.floor(idx / W) - 1;
                drops.push({
                    x: colony.ox + c * CELL + CELL / 2,       // page coordinates
                    y: colony.oy + r * CELL + CELL / 2,
                    vx: rand(-0.8, 0.8),
                    vy: rand(-0.6, 1.0),
                    spin: rand(-0.12, 0.12),
                    angle: 0,
                    size: CELL - 2,
                    hue: colony.hue,
                    startAt: now + Math.random() * 500
                });
            });
            const at = colonies.indexOf(colony);
            if (at >= 0) colonies.splice(at, 1);
            if (current === colony) current = null;
            layerDirty = true;
        }

        function updateDrops(now, scrollY) {
            for (let i = drops.length - 1; i >= 0; i--) {
                const d = drops[i];
                if (now < d.startAt) continue;
                d.vy += GRAVITY;
                d.vx *= 0.995;
                d.x += d.vx;
                d.y += d.vy;
                d.angle += d.spin;
                d.size *= 0.992;
                if (d.y - scrollY - d.size > height + 40) drops.splice(i, 1);
            }
        }

        // ---- occluders (text the cells pass under) ----------------------------------

        function collectOccluders() {
            const raw = [];
            const margin = 60;
            const pushRect = (r) => {
                if (r.width <= 0 || r.height <= 0) return;
                if (r.top + r.height < -margin || r.top > height + margin) return;
                if (r.left + r.width < -margin || r.left > width + margin) return;
                raw.push({ x: r.left, y: r.top, w: r.width, h: r.height });
            };
            // Whole-block cutouts are kept out of the merge below: merging them with the
            // toggles beside them would fuse nav + column into one viewport-wide rectangle.
            const blocks = [];
            document.querySelectorAll(COLUMN_SELECTOR).forEach((el) => {
                const r = el.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) return;
                blocks.push({ x: r.left - COLUMN_PAD, y: r.top - COLUMN_PAD, w: r.width + COLUMN_PAD * 2, h: r.height + COLUMN_PAD * 2 });
            });
            document.querySelectorAll(OCCLUDER_SELECTOR).forEach((el) => {
                if (el.closest('.cursor-info') || el.closest(COLUMN_SELECTOR)) return;
                pushRect(el.getBoundingClientRect());
            });
            document.querySelectorAll('iframe').forEach((el) => {
                if (!el.closest(COLUMN_SELECTOR)) pushRect(el.getBoundingClientRect());
            });

            // Merge blocks stacked closer than a paragraph gap (list rows, multi-line headings),
            // so cells only surface in real gaps between paragraphs.
            raw.sort((a, b) => a.y - b.y);
            const merged = [];
            raw.forEach((r) => {
                const last = merged[merged.length - 1];
                if (last && r.y - (last.y + last.h) < MERGE_GAP && r.x < last.x + last.w && r.x + r.w > last.x) {
                    const x = Math.min(last.x, r.x);
                    const right = Math.max(last.x + last.w, r.x + r.w);
                    const bottom = Math.max(last.y + last.h, r.y + r.h);
                    last.x = x; last.w = right - x; last.h = bottom - last.y;
                } else {
                    merged.push({ x: r.x, y: r.y, w: r.w, h: r.h });
                }
            });
            occluders = blocks.concat(merged.map((r) => ({
                x: r.x - OCCLUDER_PAD, y: r.y - OCCLUDER_PAD, w: r.w + OCCLUDER_PAD * 2, h: r.h + OCCLUDER_PAD * 2
            })));
        }

        // ---- drawing ----------------------------------------------------------------

        function fillColony(colony, scrollX, scrollY, bucket) {
            const { cells, born, generation, hue } = colony;
            const light = bucket === 0 ? 62 : bucket === 1 ? 52 : 42;
            const alpha = bucket === 0 ? 0.92 : bucket === 1 ? 0.78 : 0.6;
            lctx.fillStyle = `hsla(${hue},65%,${light}%,${alpha})`;
            const baseX = colony.ox - scrollX;
            const baseY = colony.oy - scrollY;
            for (let r = 1; r < W - 1; r++) {
                const y = baseY + (r - 1) * CELL;
                if (y + CELL < 0 || y > height) continue;
                const base = r * W;
                for (let c = 1; c < W - 1; c++) {
                    const idx = base + c;
                    if (!cells[idx]) continue;
                    const age = generation - born[idx];
                    const b = age < 2 ? 0 : age < 8 ? 1 : 2;
                    if (b !== bucket) continue;
                    const x = baseX + (c - 1) * CELL;
                    if (x + CELL < 0 || x > width) continue;
                    lctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
                }
            }
        }

        function renderLayer(scrollX, scrollY) {
            lctx.clearRect(0, 0, width, height);
            colonies.forEach((colony) => {
                const baseX = colony.ox - scrollX, baseY = colony.oy - scrollY;
                if (baseX > width || baseY > height || baseX + SPAN < 0 || baseY + SPAN < 0) return;
                fillColony(colony, scrollX, scrollY, 2);
                fillColony(colony, scrollX, scrollY, 1);
                fillColony(colony, scrollX, scrollY, 0);
            });
            layerScrollX = scrollX;
            layerScrollY = scrollY;
            layerDirty = false;
        }

        function draw(now, scrollX, scrollY) {
            if (layerDirty || scrollX !== layerScrollX || scrollY !== layerScrollY) renderLayer(scrollX, scrollY);
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, width, height);

            drops.forEach((d) => {
                ctx.save();
                ctx.translate(d.x - scrollX, d.y - scrollY);
                ctx.rotate(d.angle);
                ctx.fillStyle = `hsla(${d.hue},60%,48%,0.55)`;
                ctx.fillRect(-d.size / 2, -d.size / 2, d.size, d.size);
                ctx.restore();
            });

            ctx.font = '12px Georgia, "Times New Roman", serif';
            colonies.forEach((colony) => {
                if (now >= colony.labelUntil) return;
                const t = (colony.labelUntil - now) / LABEL_MS;
                ctx.fillStyle = `hsla(${colony.hue},50%,45%,${Math.min(1, t * 1.6) * 0.9})`;
                ctx.fillText(`${colony.rule.code} · ${colony.rule.name}`, colony.labelX - scrollX + 18, colony.labelY - scrollY - 14);
            });

            // Everything drawn so far disappears under the content column (and the nav),
            // so the colonies only ever show in the margins beside the page.
            for (let i = 0; i < occluders.length; i++) {
                const o = occluders[i];
                ctx.clearRect(o.x, o.y, o.w, o.h);
            }

            const hue = state.hue;
            const size = 12 + Math.min(6, state.speed * 0.8);
            ctx.save();
            ctx.translate(state.x, state.y);
            ctx.rotate(state.angle);
            ctx.strokeStyle = `hsla(${hue},70%,50%,0.9)`;
            ctx.lineWidth = 1.6;
            ctx.strokeRect(-size / 2, -size / 2, size, size);
            const inner = 3 + Math.sin(state.time * 4) * 1.2;
            ctx.fillStyle = `hsla(${hue},70%,55%,0.85)`;
            ctx.fillRect(-inner / 2, -inner / 2, inner, inner);
            ctx.restore();
        }

        // ---- main loop --------------------------------------------------------------

        function frame() {
            const now = performance.now();
            if (mode !== 'life') {
                requestAnimationFrame(frame);
                return;
            }
            const scrollX = window.scrollX || 0;
            const scrollY = window.scrollY || 0;

            const dx = state.targetX - state.x;
            const dy = state.targetY - state.y;
            state.vx = state.vx * 0.18 + dx * 0.22;
            state.vy = state.vy * 0.18 + dy * 0.22;
            state.x += state.vx;
            state.y += state.vy;
            state.speed = Math.hypot(state.vx, state.vy);
            state.time += 0.016;
            if (state.speed > 0.3) state.angle = Math.atan2(state.vy, state.vx);

            const pageX = state.x + scrollX;
            const pageY = state.y + scrollY;

            const moved = state.moved;
            state.moved = false;
            if (moved) {
                const paused = now - state.lastMoveAt > STOP_MS;
                state.lastMoveAt = now;
                if (!current || paused || !contains(current, pageX, pageY)) newColony(now, pageX, pageY);
            }
            if (current && (moved || state.speed > 0.6) && contains(current, pageX, pageY)) seed(current, pageX, pageY);

            for (let i = colonies.length - 1; i >= 0; i--) {
                if (now >= colonies[i].endsAt) dropColony(colonies[i], now);
            }
            if (now - stepClock > 1000) stepClock = now;   // tab was hidden; don't catch up
            while (now - stepClock >= STEP_MS) {
                colonies.forEach(step);
                stepClock += STEP_MS;
                layerDirty = true;
            }

            updateDrops(now, scrollY);

            if (occludersDirty || now - occludersAt > OCCLUDER_REFRESH_MS) {
                collectOccluders();
                occludersDirty = false;
                occludersAt = now;
            }

            draw(now, scrollX, scrollY);
            requestAnimationFrame(frame);
        }

        requestAnimationFrame(frame);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
