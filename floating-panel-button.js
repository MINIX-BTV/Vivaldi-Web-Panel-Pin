/* 

created by MINIX-BTV

*/

(function () {
    'use strict';

    // ─── Constants ────────────────────────────────────────────────────────────

    const SELECTOR_TOOLBAR        = '.toolbar.toolbar-group';
    const SELECTOR_ACTIVE_PANEL   = '.button-toolbar-webpanel.active button[data-name^="WEBPANEL_"]';
    const ID_WRAP                 = 'vivaldi-float-toggle-wrap';
    const ID_BTN                  = 'vivaldi-float-toggle-btn';
    const PREFS_KEY               = 'vivaldi.panels.web.elements';
    const INITIAL_CHECK_DELAY_MS  = 400;

    const UNPIN = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
            <path d="M17 4a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v1l2 4v3l-4 3v2h6v5l1 2 1-2v-5h6v-2l-4-3V9l2-4V4z" fill="currentColor"/>
        </svg>`;

    const PIN = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
            <path d="M17 4a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v1l2 4v3l-4 3v2h6v5l1 2 1-2v-5h6v-2l-4-3V9l2-4V4z" fill="var(--colorHighlightBg)"/>
        </svg>`;

    // ─── State ────────────────────────────────────────────────────────────────

    let activePanelId  = null;
    let previousPanelId = null;
    let wrapEl         = null;
    let btnEl          = null;

    // ─── Init ─────────────────────────────────────────────────────────────────

    function init() {
        injectStyles();
        startPanelDetection();
        watchButtonRemoval();
    }

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #${ID_WRAP} {
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            #${ID_BTN} {
                all: unset;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 100%; height: 100%;
                cursor: pointer;
                color: inherit;
                transition: color 0.16s ease;
            }
            #${ID_WRAP}.is-floating #${ID_BTN} {
                color: var(--colorAccentBg, #8ab4f8);
            }
            #${ID_WRAP}.disabled,
            #${ID_WRAP}.no-active-panel {
                opacity: 0.4;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }

    // ─── Panel detection (formerly script 2) ─────────────────────────────────

    function getActiveWebPanelId() {
        return document.querySelector(SELECTOR_ACTIVE_PANEL)?.getAttribute("data-name") ?? null;
    }

    async function notifyIfPanelChanged() {
        const currentPanelId = getActiveWebPanelId();
        if (currentPanelId === previousPanelId) return;

        previousPanelId = currentPanelId;
        activePanelId   = currentPanelId;

        if (activePanelId) {
            await mountButton();
            await refreshButtonState();
        } else {
            setButtonDisabled();
        }
    }

    function startPanelDetection() {
        const observer = new MutationObserver(notifyIfPanelChanged);
        observer.observe(document.body, {
            attributes:    true,
            attributeFilter: ['class'],
            childList:     true,
            subtree:       true,
        });

        setTimeout(notifyIfPanelChanged, INITIAL_CHECK_DELAY_MS);
    }

    // ─── Button mounting ──────────────────────────────────────────────────────

    async function mountButton() {
        if (document.getElementById(ID_WRAP)) return;

        const toolbar = document.querySelector(SELECTOR_TOOLBAR) ?? await waitForElement(SELECTOR_TOOLBAR);
        if (!toolbar) return;

        const wrap = document.createElement('div');
        wrap.id = ID_WRAP;
        wrap.className = 'button-toolbar';

        const btn = document.createElement('button');
        btn.id = ID_BTN;
        btn.type = 'button';
        btn.title = 'Toggle floating';
        btn.innerHTML = UNPIN;
        btn.addEventListener('click', onToggleClick);

        wrap.appendChild(btn);
        toolbar.insertAdjacentElement('afterend', wrap);

        wrapEl = wrap;
        btnEl  = btn;
    }

    function waitForElement(selector) {
        return new Promise(resolve => {
            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        });
    }

    // Re-mounts the button if it's removed from the DOM (e.g. after a toolbar refresh).
    function watchButtonRemoval() {
        const removalObserver = new MutationObserver((mutations) => {
            for (const { removedNodes } of mutations) {
                for (const node of removedNodes) {
                    if (node.nodeType !== 1) continue;

                    const buttonWasRemoved = node.id === ID_WRAP || node.querySelector?.(`#${ID_WRAP}`);
                    if (!buttonWasRemoved) continue;

                    wrapEl = btnEl = null;
                    if (activePanelId) {
                        mountButton().then(refreshButtonState);
                    }
                    return;
                }
            }
        });

        const bootstrapObserver = new MutationObserver(() => {
            const toolbar = document.querySelector(SELECTOR_TOOLBAR);
            if (!toolbar) return;

            bootstrapObserver.disconnect();
            removalObserver.observe(toolbar.parentElement, { childList: true });
        });
        bootstrapObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    // ─── Button appearance ────────────────────────────────────────────────────

    async function refreshButtonState() {
        if (!btnEl || !wrapEl) return;

        const floating = await isPanelFloating();

        btnEl.innerHTML = !floating ? PIN : UNPIN;
        btnEl.title     = !floating ? 'Floating — click to dock' : 'Docked — click to float';
        wrapEl.classList.toggle('is-floating', !floating);
        wrapEl.classList.remove('disabled', 'no-active-panel');
    }

    function setButtonDisabled() {
        if (!wrapEl) return;
        wrapEl.classList.add('no-active-panel');
        if (btnEl) {
            btnEl.innerHTML = UNPIN;
            btnEl.title = 'No active web panel';
        }
    }

    // ─── Prefs read ───────────────────────────────────────────────────────────

    async function isPanelFloating() {
        if (!activePanelId) return false;

        try {
            const elements = await vivaldi.prefs.get(PREFS_KEY) ?? [];
            return elements.find(el => el.id === activePanelId)?.floating === true;
        } catch (err) {
            console.warn('[float-toggle] Cannot read prefs:', err);
            return false;
        }
    }

    // ─── Toggle ───────────────────────────────────────────────────────────────

    async function onToggleClick() {
        if (!activePanelId) return;

        const targetState = !(await isPanelFloating());

        try {
            const panels = await vivaldi.prefs.get(PREFS_KEY);
            const panel  = panels.find(p => p.id === activePanelId);
            if (panel) panel.floating = targetState;

            await vivaldi.prefs.set({ path: PREFS_KEY, value: panels });
            await refreshButtonState();
        } catch (err) {
            console.warn('[float-toggle] Toggle error:', err);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    init();
})();