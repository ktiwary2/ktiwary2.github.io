/* global requestAnimationFrame */
(function () {
    'use strict';

    const POINTER_MESSAGE = 'evolving-cursor:pointer';

    // Inside an iframe: forward pointer data to the parent and exit.
    if (window.top !== window) {
        const frameId = window.name || '';
        if (frameId && window.parent) {
            const send = (payload) => {
                window.parent.postMessage(Object.assign({ type: POINTER_MESSAGE, frameId }, payload), '*');
            };
            const forward = (event) => {
                send({ x: event.clientX, y: event.clientY });
            };
            window.addEventListener('pointermove', forward, { passive: true });
            window.addEventListener('pointerdown', forward, { passive: true });
            window.addEventListener('pointerenter', forward, { passive: true });
            window.addEventListener('pointerleave', () => send({ leave: true }), { passive: true });
        }
        return;
    }

    function initEvolvingCursor() {
        if (!document.body) return;
        if (document.body.dataset.cursorInitialized === 'true') return;

        let canvas = document.getElementById('cursor-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'cursor-canvas';
            canvas.className = 'cursor-canvas';
            document.body.appendChild(canvas);
        }

        const ctx = canvas.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let width = window.innerWidth;
        let height = window.innerHeight;

        function resize() {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        resize();
        window.addEventListener('resize', resize);

        const palette = [
            [12, 70, 45],
            [200, 60, 35],
            [34, 70, 40],
            [280, 45, 45],
            [150, 50, 38]
        ];

        const constants = {
            FOLLOW_STIFFNESS: 0.22,
            FRICTION: 0.18,
            MEMORY_DECAY: 0.993,
            MAX_PARTICLES: 45,
            MAX_MEMORIES: 22,
            BASE_SIZE: 14,
            DISTANCE_FOR_FLOCK: 26,
            FLOCK_MAX: 16,
            FLOCK_MAX_SPEED: 4.2,
            FLOCK_NOISE: 0.05,
            FLOCK_COHESION: 0.032,
            FLOCK_SEPARATION: 28,
            GRAVITY: 0.42,
            INACTIVITY_THRESHOLD: 10000
        };

        const state = {
            x: width / 2,
            y: height / 2,
            vx: 0,
            vy: 0,
            targetX: width / 2,
            targetY: height / 2,
            hue: 200,
            time: 0,
            speed: 0,
            shape: 'circle',
            angle: 0,
            shapeParams: null,
            nextMorphAt: performance.now() + 1400,
            morphHoldUntil: 0,
            hoverBoostUntil: 0,
            particles: [],
            memory: [],
            satellites: [],
            orbiters: [{ angle: 0 }, { angle: Math.PI }],
            flock: [],
            distanceAccumulator: 0,
            hovering: false,
            inactive: false,
            lastPointerMove: performance.now()
        };

        document.body.classList.add('custom-cursor-enabled');
        document.body.dataset.cursorInitialized = 'true';

        let evolutionEnabled = true;

        const toggleButton = document.getElementById('cursor-toggle');
        const infoDialog = document.getElementById('cursor-info');
        const showInfo = () => {
            if (infoDialog) infoDialog.classList.add('visible');
        };
        const hideInfo = () => {
            if (infoDialog) infoDialog.classList.remove('visible');
        };

        function updateToggleButton() {
            if (!toggleButton) return;
            const label = evolutionEnabled ? 'Evolve Cursor: On' : 'Evolve Cursor: Off';
            toggleButton.textContent = label;
            toggleButton.setAttribute('aria-pressed', evolutionEnabled ? 'true' : 'false');
        }
        if (toggleButton) {
            updateToggleButton();
            toggleButton.addEventListener('click', () => {
                evolutionEnabled = !evolutionEnabled;
                updateToggleButton();
                if (!evolutionEnabled) {
                    state.flock.length = 0;
                    state.particles.length = 0;
                    state.satellites.length = 0;
                } else {
                    state.distanceAccumulator = 0;
                }
            });
            toggleButton.addEventListener('pointerenter', showInfo);
            toggleButton.addEventListener('pointerleave', (event) => {
                if (!toggleButton.contains(event.relatedTarget)) {
                    hideInfo();
                }
            });
            toggleButton.addEventListener('focus', showInfo);
            toggleButton.addEventListener('blur', hideInfo);
        }

        function registerMovement() {
            state.lastPointerMove = performance.now();
            if (state.inactive) {
                state.inactive = false;
            }
        }

        function rand(min, max) {
            return min + Math.random() * (max - min);
        }

        function choice(arr) {
            return arr[(Math.random() * arr.length) | 0];
        }

        function scheduleNextMorph() {
            const now = performance.now();
            const base = state.speed > 3 ? 420 : state.speed > 1.5 ? 940 : 1800;
            state.nextMorphAt = now + base + Math.random() * base;
        }

        function morphPolygon() {
            const verts = Math.max(3, Math.min(10, Math.round(rand(4, 8))));
            const rotation = rand(0, Math.PI * 2);
            const color = choice(palette);
            const fill = Math.random() < 0.4;
            const jitter = state.speed > 2.4 ? rand(0.25, 0.55) : rand(0.08, 0.2);
            state.shape = 'polygon';
            state.shapeParams = { verts, rotation, color, fill, jitter };
            state.morphHoldUntil = performance.now() + 1200 + Math.random() * 1000;
            scheduleNextMorph();
        }

        function setHoverMutation(on) {
            state.hovering = !!on;
            if (!on) return;
            state.hoverBoostUntil = performance.now() + 800;
            if (!evolutionEnabled || state.inactive) return;
            if (state.satellites.length < 4) {
                state.satellites.push({
                    angle: Math.random() * Math.PI * 2,
                    radius: rand(16, 22),
                    speed: rand(0.02, 0.065),
                    size: rand(2.2, 3.1),
                    hue: (state.hue + rand(-20, 20)) % 360,
                    until: performance.now() + 1400
                });
            }
        }

        document.addEventListener('mouseover', (event) => {
            if (event.target.closest('a,button,.section-toggle')) setHoverMutation(true);
        });
        document.addEventListener('mouseout', (event) => {
            if (event.target.closest('a,button,.section-toggle')) setHoverMutation(false);
        });

        function addMemory(x, y) {
            state.memory.push({ x, y, strength: 1, hue: state.hue, seed: Math.random() * Math.PI * 2 });
            if (state.memory.length > constants.MAX_MEMORIES) {
                state.memory.shift();
            }
        }
        let lastHoverSample = 0;

        function spawnParticle(x, y, vx, vy, life, shape) {
            if (!evolutionEnabled || state.inactive) return;
            state.particles.push({ x, y, vx, vy, life, maxLife: life, shape });
            if (state.particles.length > constants.MAX_PARTICLES) {
                state.particles.splice(0, state.particles.length - constants.MAX_PARTICLES);
            }
        }

        function cloneShapeParams() {
            if (!state.shapeParams) return null;
            return {
                verts: state.shapeParams.verts,
                rotation: state.shapeParams.rotation,
                color: state.shapeParams.color,
                fill: state.shapeParams.fill,
                jitter: state.shapeParams.jitter,
                seed: Math.random() * Math.PI * 2
            };
        }

        function dropFlock() {
            state.flock.forEach((shape) => {
                if (!shape.falling) {
                    shape.falling = true;
                    shape.spin *= 2.2;
                    shape.vy = Math.abs(shape.vy) * 0.4 + rand(0.6, 1.2);
                    shape.vx += rand(-0.6, 0.6);
                }
            });
        }

        function spawnFlockShape() {
            if (!evolutionEnabled || state.inactive) {
                return;
            }
            const entry = {
                x: state.x,
                y: state.y,
                vx: state.vx + rand(-0.6, 0.6),
                vy: state.vy + rand(-0.6, 0.6),
                angle: state.angle,
                spin: rand(-0.035, 0.045),
                size: Math.max(constants.BASE_SIZE * 0.9, constants.BASE_SIZE + state.speed * 0.6),
                hue: (state.hue + rand(-18, 18) + 360) % 360,
                type: state.shape,
                params: cloneShapeParams(),
                seed: Math.random() * Math.PI * 2,
                createdAt: performance.now(),
                falling: false
            };
            state.flock.push(entry);
            if (state.flock.length > constants.FLOCK_MAX) {
                for (const shape of state.flock) {
                    if (!shape.falling) {
                        shape.falling = true;
                        shape.spin *= 2.2;
                        shape.vy = Math.abs(shape.vy) * 0.4 + rand(0.6, 1.1);
                        shape.vx += rand(-0.5, 0.5);
                        break;
                    }
                }
            }
        }

        function updateFlock() {
            for (let i = state.flock.length - 1; i >= 0; i--) {
                const shape = state.flock[i];
                if (shape.falling) {
                    shape.vy += constants.GRAVITY;
                    shape.vx *= 0.995;
                    shape.x += shape.vx;
                    shape.y += shape.vy;
                    shape.angle += shape.spin;
                    shape.size *= 0.985;
                    if (shape.y - shape.size > height + 80) {
                        state.flock.splice(i, 1);
                    }
                    continue;
                }

                const toCursorX = state.x - shape.x;
                const toCursorY = state.y - shape.y;
                const dist = Math.hypot(toCursorX, toCursorY) || 1;

                shape.vx += state.vx * 0.07;
                shape.vy += state.vy * 0.07;

                shape.vx += (toCursorX / dist) * constants.FLOCK_COHESION;
                shape.vy += (toCursorY / dist) * constants.FLOCK_COHESION;

                for (let j = 0; j < state.flock.length; j++) {
                    if (i === j) continue;
                    const other = state.flock[j];
                    if (other.falling) continue;
                    const dx = shape.x - other.x;
                    const dy = shape.y - other.y;
                    const distSq = dx * dx + dy * dy;
                    const min = constants.FLOCK_SEPARATION;
                    if (distSq > 0 && distSq < min * min) {
                        const factor = 0.0025 * (1 - Math.sqrt(distSq) / min);
                        shape.vx += dx * factor;
                        shape.vy += dy * factor;
                    }
                }

                shape.vx += Math.cos(state.time * 0.8 + shape.seed) * constants.FLOCK_NOISE;
                shape.vy += Math.sin(state.time * 0.8 + shape.seed) * constants.FLOCK_NOISE;

                const speed = Math.hypot(shape.vx, shape.vy);
                if (speed > constants.FLOCK_MAX_SPEED) {
                    const scale = constants.FLOCK_MAX_SPEED / speed;
                    shape.vx *= scale;
                    shape.vy *= scale;
                }

                shape.x += shape.vx;
                shape.y += shape.vy;
                shape.angle += shape.spin;
            }
        }

        function drawShape(type, x, y, size, angle, hue, params, alpha) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.strokeStyle = `hsla(${hue},70%,55%,${alpha})`;
            ctx.fillStyle = `hsla(${hue},70%,55%,${Math.min(alpha, 0.8) * 0.38})`;
            ctx.lineWidth = 1.6;

            if (type === 'circle') {
                ctx.beginPath();
                ctx.arc(0, 0, size, 0, Math.PI * 2);
                ctx.stroke();
            } else if (type === 'triangle') {
                ctx.beginPath();
                ctx.moveTo(0, -size);
                ctx.lineTo(size * 0.866, size * 0.5);
                ctx.lineTo(-size * 0.866, size * 0.5);
                ctx.closePath();
                ctx.stroke();
            } else if (type === 'polygon' && params) {
                ctx.beginPath();
                for (let i = 0; i < params.verts; i++) {
                    const a = params.rotation + (i * Math.PI * 2) / params.verts;
                    const jitter = 1 + Math.sin(state.time * 1.8 + i + (params.seed || 0)) * (params.jitter || 0);
                    const radius = size * jitter;
                    const px = Math.cos(a) * radius;
                    const py = Math.sin(a) * radius;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                if (params.fill) ctx.fill();
                ctx.stroke();
            } else {
                const spikes = 6;
                ctx.beginPath();
                for (let i = 0; i < spikes; i++) {
                    const a = (i * Math.PI * 2) / spikes;
                    const r1 = size * 0.75;
                    const r2 = size + 7;
                    ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
                    ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
                }
                ctx.stroke();
            }

            ctx.restore();
        }

        function handleMessage(event) {
            const data = event.data;
            if (!data || data.type !== POINTER_MESSAGE) return;
            if (!data.frameId) return;
            const iframe = document.querySelector(`iframe[name=\"${data.frameId}\"]`);
            if (!iframe) return;
            if (data.leave) {
                state.hovering = false;
                return;
            }
            const rect = iframe.getBoundingClientRect();
            state.targetX = rect.left + data.x;
            state.targetY = rect.top + data.y;
            registerMovement();
        }
        window.addEventListener('message', handleMessage);

        function wireIframe(iframe) {
            const pointerUpdate = (event) => {
                state.targetX = event.clientX;
                state.targetY = event.clientY;
                registerMovement();
            };
            iframe.addEventListener('pointermove', pointerUpdate);
            iframe.addEventListener('pointerenter', pointerUpdate);
            iframe.addEventListener('pointerleave', () => { state.hovering = false; });

            const bind = () => {
                try {
                    const doc = iframe.contentDocument;
                    if (!doc) return;
                    doc.addEventListener('mousemove', (evt) => {
                        const rect = iframe.getBoundingClientRect();
                        state.targetX = rect.left + evt.clientX;
                        state.targetY = rect.top + evt.clientY;
                        registerMovement();
                    });
                    doc.addEventListener('mouseover', (evt) => {
                        if (evt.target.closest && evt.target.closest('a,button,.section-toggle')) setHoverMutation(true);
                    });
                    doc.addEventListener('mouseout', (evt) => {
                        if (evt.target.closest && evt.target.closest('a,button,.section-toggle')) setHoverMutation(false);
                    });
                } catch (err) {
                    // Cross-origin iframe, rely on postMessage fallback.
                }
            };

            if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
                bind();
            } else {
                iframe.addEventListener('load', bind);
            }
        }
        document.querySelectorAll('#news-section iframe, #publications-section iframe').forEach(wireIframe);

        function drawCursor() {
            const dx = state.targetX - state.x;
            const dy = state.targetY - state.y;
            state.vx = state.vx * constants.FRICTION + dx * constants.FOLLOW_STIFFNESS;
            state.vy = state.vy * constants.FRICTION + dy * constants.FOLLOW_STIFFNESS;
            state.x += state.vx;
            state.y += state.vy;
            state.speed = Math.hypot(state.vx, state.vy);
            state.time += 0.016;

            const now = performance.now();
            if (!state.inactive && (now - state.lastPointerMove) > constants.INACTIVITY_THRESHOLD) {
                state.inactive = true;
                dropFlock();
                state.satellites.length = 0;
            }

            const instAngle = Math.atan2(state.vy, state.vx);
            if (state.speed > 0.25 && now >= state.morphHoldUntil) {
                state.angle = instAngle;
                if (state.speed < 1.2) {
                    state.shape = 'circle';
                } else if (state.speed < 3) {
                    state.shape = 'triangle';
                } else {
                    state.shape = 'spiky';
                }
            }

            state.hue = (state.hue + 0.25) % 360;
            const baseSize = constants.BASE_SIZE + Math.sin(state.time * 1.7) * 2.1;
            let size = baseSize + Math.min(9, state.speed * 1.1);
            if (now < state.hoverBoostUntil) size += 3.2;
            state.distanceAccumulator += state.speed;
            if (state.distanceAccumulator > constants.DISTANCE_FOR_FLOCK) {
                spawnFlockShape();
                state.distanceAccumulator = 0;
            }

            if (now >= state.nextMorphAt) {
                morphPolygon();
            }

            if (state.speed > 0.45) {
                const ang = Math.atan2(state.vy, state.vx) + Math.PI;
                const pv = 0.45 + Math.min(1.4, state.speed * 0.1);
                spawnParticle(
                    state.x,
                    state.y,
                    Math.cos(ang) * pv,
                    Math.sin(ang) * pv,
                    36 + Math.random() * 18,
                    Math.random() < 0.5 ? 'circle' : 'line'
                );
            }

            if (state.hovering && now - lastHoverSample > 360) {
                addMemory(state.x, state.y);
                lastHoverSample = now;
            }

            ctx.clearRect(0, 0, width, height);

            for (let i = state.particles.length - 1; i >= 0; i--) {
                const p = state.particles[i];
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 1;
                const alpha = Math.max(0, p.life / p.maxLife) * 0.5;
                ctx.strokeStyle = `hsla(${state.hue},60%,40%,${alpha})`;
                ctx.fillStyle = `hsla(${state.hue},60%,40%,${alpha})`;
                ctx.lineWidth = 1;
                if (p.shape === 'circle') {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p.x - p.vx * 2.3, p.y - p.vy * 2.3);
                    ctx.stroke();
                }
                if (p.life <= 0) state.particles.splice(i, 1);
            }

            for (let i = state.memory.length - 1; i >= 0; i--) {
                const m = state.memory[i];
                m.strength *= constants.MEMORY_DECAY;
                if (m.strength < 0.05) {
                    state.memory.splice(i, 1);
                    continue;
                }
                ctx.strokeStyle = `hsla(${m.hue},60%,45%,${m.strength * 0.45})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(m.x, m.y, 14 + (1 - m.strength) * 12, 0, Math.PI * 2);
                ctx.stroke();
            }

            updateFlock();
            state.flock.forEach((shape) => {
                const alpha = shape.falling ? 0.35 : 0.65;
                drawShape(shape.type, shape.x, shape.y, shape.size, shape.angle, shape.hue, shape.params, alpha);
            });

            state.orbiters.forEach((o, idx) => {
                o.angle += 0.04 * (idx % 2 === 0 ? 1 : -1);
                const radius = size * 0.85;
                const ox = state.x + Math.cos(o.angle) * radius;
                const oy = state.y + Math.sin(o.angle) * radius;
                ctx.beginPath();
                ctx.fillStyle = `hsla(${state.hue},70%,60%,0.55)`;
                ctx.arc(ox, oy, 2.2, 0, Math.PI * 2);
                ctx.fill();
            });

            if (!evolutionEnabled || state.inactive) {
                state.satellites.length = 0;
            } else if (state.satellites.length) {
                state.satellites = state.satellites.filter((sat) => sat.until === 0 || sat.until > now);
                state.satellites.forEach((sat) => {
                    sat.angle += sat.speed;
                    const sx = state.x + Math.cos(sat.angle) * sat.radius;
                    const sy = state.y + Math.sin(sat.angle) * sat.radius;
                    ctx.beginPath();
                    ctx.fillStyle = `hsla(${sat.hue},70%,65%,0.45)`;
                    ctx.arc(sx, sy, sat.size, 0, Math.PI * 2);
                    ctx.fill();
                });
            }

            drawShape(state.shape, state.x, state.y, size, state.angle, state.hue, state.shapeParams, 0.9);

            requestAnimationFrame(drawCursor);
        }

        const updateTargetFromPointer = (event) => {
            state.targetX = event.clientX;
            state.targetY = event.clientY;
            registerMovement();
        };
        document.addEventListener('pointermove', updateTargetFromPointer, { passive: true });
        document.addEventListener('mousemove', updateTargetFromPointer, { passive: true });

        requestAnimationFrame(drawCursor);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEvolvingCursor, { once: true });
    } else {
        initEvolvingCursor();
    }
})();
