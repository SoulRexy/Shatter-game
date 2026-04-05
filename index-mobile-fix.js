// ==================== MOBILE TOUCH CONTROLS =====================
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

let touchJoystickActive = false;
let touchJoystickStart = { x: 0, y: 0 };
let touchJoystickId = null;
let activeButtonTouches = {}; // Track active button touches to prevent double input
const JOYSTICK_DEADZONE = 12;
const JOYSTICK_MAXDIST = 35;

// Mobile speed adjustment - slower acceleration to match PC feel
const MOBILE_LERP_FACTOR = 0.18; // Lower than PC's 0.3 for smoother acceleration

// Default mobile config
const defaultMobileConfig = {
    joystickSize: 100,
    joystickOpacity: 100,
    buttonSize: 55,
    buttonOpacity: 100,
    joystickSide: 'left',
    joystickX: 80,
    joystickY: 80,
    jumpX: 460,
    jumpY: 80,
    attackX: 540,
    attackY: 80,
    dashX: 460,
    dashY: 150,
    shatterX: 540,
    shatterY: 150
};
let mobileConfig = { ...defaultMobileConfig };

// Load saved mobile config
function loadMobileConfig() {
    try {
        const saved = localStorage.getItem('shatter_mobile');
        if (saved) {
            mobileConfig = { ...defaultMobileConfig, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.warn('Failed to load mobile config:', e);
    }
}

// Save mobile config
function saveMobileConfig() {
    try {
        localStorage.setItem('shatter_mobile', JSON.stringify(mobileConfig));
    } catch (e) {
        console.warn('Failed to save mobile config:', e);
    }
}

// Apply mobile config to UI
function applyMobileConfig() {
    const joystickArea = document.getElementById('joystickArea');
    const joystickBase = document.getElementById('joystickBase');
    const joystickThumb = document.getElementById('joystickThumb');
    const actionButtons = document.getElementById('actionButtons');

    if (!joystickArea || !joystickBase || !joystickThumb || !actionButtons) return;

    const size = mobileConfig.joystickSize;
    const joyOpacity = mobileConfig.joystickOpacity / 100;
    const btnSize = mobileConfig.buttonSize;
    const btnOpacity = mobileConfig.buttonOpacity / 100;
    const joyX = mobileConfig.joystickX;
    const joyY = mobileConfig.joystickY;

    // Apply joystick size and opacity
    joystickBase.style.width = size + 'px';
    joystickBase.style.height = size + 'px';
    joystickBase.style.opacity = joyOpacity;
    joystickThumb.style.width = (size * 0.4) + 'px';
    joystickThumb.style.height = (size * 0.4) + 'px';
    joystickArea.style.width = (size + 20) + 'px';
    joystickArea.style.height = (size + 20) + 'px';

    // Apply joystick position
    joystickArea.style.left = joyX + 'px';
    joystickArea.style.bottom = joyY + 'px';

    // Apply button sizes, opacity and positions
    const buttons = actionButtons.querySelectorAll('.touch-btn');
    const btnPositions = {
        jump: { x: mobileConfig.jumpX, y: mobileConfig.jumpY },
        attack: { x: mobileConfig.attackX, y: mobileConfig.attackY },
        dash: { x: mobileConfig.dashX, y: mobileConfig.dashY },
        shatter: { x: mobileConfig.shatterX, y: mobileConfig.shatterY }
    };

    buttons.forEach(btn => {
        const action = btn.dataset.action;
        btn.style.width = btnSize + 'px';
        btn.style.height = btnSize + 'px';
        btn.style.fontSize = Math.max(8, btnSize * 0.15) + 'px';
        btn.style.opacity = btnOpacity;

        // Apply individual button positions
        if (btnPositions[action]) {
            if (btnPositions[action].x !== 0 || btnPositions[action].y !== 0) {
                btn.style.position = 'absolute';
                btn.style.right = 'auto';
                btn.style.left = btnPositions[action].x + 'px';
                btn.style.bottom = btnPositions[action].y + 'px';
            }
        }
    });
}

// ==================== CUSTOMIZE CONTROLS MODE ====================
let customizeMode = false;
let dragTarget = null;
let dragOffset = { x: 0, y: 0 };
let editingControl = null;

function enterCustomizeMode() {
    customizeMode = true;
    const overlay = document.getElementById('customizeOverlay');
    if (!overlay) return;

    overlay.style.display = 'block';
    loadMobileConfig();
    applyCustomizePositions();
}

function exitCustomizeMode() {
    customizeMode = false;
    const overlay = document.getElementById('customizeOverlay');
    if (overlay) overlay.style.display = 'none';
    closeControlEditPopup();
    saveMobileConfig();
    applyMobileConfig();
}

function applyCustomizePositions() {
    const joyArea = document.getElementById('customizeJoystickArea');
    if (joyArea) {
        joyArea.style.left = mobileConfig.joystickX + 'px';
        joyArea.style.bottom = mobileConfig.joystickY + 'px';

        const base = document.getElementById('customizeJoystickBase');
        if (base) {
            base.style.width = mobileConfig.joystickSize + 'px';
            base.style.height = mobileConfig.joystickSize + 'px';
            base.style.opacity = mobileConfig.joystickOpacity / 100;
        }
        const thumb = document.getElementById('customizeJoystickThumb');
        if (thumb) {
            thumb.style.width = (mobileConfig.joystickSize * 0.4) + 'px';
            thumb.style.height = (mobileConfig.joystickSize * 0.4) + 'px';
        }
    }

    const buttons = document.querySelectorAll('.customize-btn');
    const btnPositions = {
        jump: { x: mobileConfig.jumpX, y: mobileConfig.jumpY },
        attack: { x: mobileConfig.attackX, y: mobileConfig.attackY },
        dash: { x: mobileConfig.dashX, y: mobileConfig.dashY },
        shatter: { x: mobileConfig.shatterX, y: mobileConfig.shatterY }
    };

    buttons.forEach(btn => {
        const action = btn.dataset.control;
        if (btnPositions[action]) {
            btn.style.left = btnPositions[action].x + 'px';
            btn.style.bottom = btnPositions[action].y + 'px';
            btn.style.width = mobileConfig.buttonSize + 'px';
            btn.style.height = mobileConfig.buttonSize + 'px';
            btn.style.opacity = mobileConfig.buttonOpacity / 100;
        }
    });
}

function openControlEditPopup(controlType, element) {
    editingControl = controlType;
    const popup = document.getElementById('controlEditPopup');
    const title = document.getElementById('controlEditTitle');
    const sizeSlider = document.getElementById('controlSizeSlider');
    const opacitySlider = document.getElementById('controlOpacitySlider');

    if (!popup) return;

    // Set title
    const titles = {
        joystick: 'JOYSTICK',
        jump: 'JUMP',
        attack: 'ATTACK',
        dash: 'DASH',
        shatter: 'SHATTER'
    };
    title.textContent = titles[controlType] || controlType.toUpperCase();

    // Set current values
    if (controlType === 'joystick') {
        sizeSlider.value = mobileConfig.joystickSize;
        opacitySlider.value = mobileConfig.joystickOpacity;
    } else {
        sizeSlider.value = mobileConfig.buttonSize;
        opacitySlider.value = mobileConfig.buttonOpacity;
    }

    // Position popup near the element
    const rect = element.getBoundingClientRect();
    popup.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
    popup.style.top = Math.max(60, rect.top - 120) + 'px';
    popup.style.display = 'block';
}

function closeControlEditPopup() {
    editingControl = null;
    const popup = document.getElementById('controlEditPopup');
    if (popup) popup.style.display = 'none';
}

function initCustomizeControls() {
    const customizeBtn = document.getElementById('customizeControlsBtn');
    if (customizeBtn) {
        customizeBtn.addEventListener('click', enterCustomizeMode);
    }

    const doneBtn = document.getElementById('customizeDoneBtn');
    if (doneBtn) {
        doneBtn.addEventListener('click', exitCustomizeMode);
    }

    const resetBtn = document.getElementById('customizeResetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            mobileConfig = { ...defaultMobileConfig };
            applyCustomizePositions();
        });
    }

    const closeEditBtn = document.getElementById('controlEditClose');
    if (closeEditBtn) {
        closeEditBtn.addEventListener('click', closeControlEditPopup);
    }

    // Size slider
    const sizeSlider = document.getElementById('controlSizeSlider');
    if (sizeSlider) {
        sizeSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            if (editingControl === 'joystick') {
                mobileConfig.joystickSize = val;
                const base = document.getElementById('customizeJoystickBase');
                const thumb = document.getElementById('customizeJoystickThumb');
                if (base) {
                    base.style.width = val + 'px';
                    base.style.height = val + 'px';
                }
                if (thumb) {
                    thumb.style.width = (val * 0.4) + 'px';
                    thumb.style.height = (val * 0.4) + 'px';
                }
            } else {
                mobileConfig.buttonSize = val;
                document.querySelectorAll('.customize-btn').forEach(btn => {
                    btn.style.width = val + 'px';
                    btn.style.height = val + 'px';
                });
            }
        });
    }

    // Opacity slider
    const opacitySlider = document.getElementById('controlOpacitySlider');
    if (opacitySlider) {
        opacitySlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            const opacity = val / 100;
            if (editingControl === 'joystick') {
                mobileConfig.joystickOpacity = val;
                const base = document.getElementById('customizeJoystickBase');
                if (base) base.style.opacity = opacity;
            } else {
                mobileConfig.buttonOpacity = val;
                document.querySelectorAll('.customize-btn').forEach(btn => {
                    btn.style.opacity = opacity;
                });
            }
        });
    }

    // Drag and tap handlers for joystick
    const joyArea = document.getElementById('customizeJoystickArea');
    if (joyArea) {
        // Tap to edit
        joyArea.addEventListener('click', (e) => {
            if (!dragTarget) {
                openControlEditPopup('joystick', joyArea);
            }
        });

        // Drag to move
        joyArea.addEventListener('touchstart', (e) => {
            if (e.target.closest('#controlEditPopup')) return;
            dragTarget = joyArea;
            const touch = e.touches[0];
            const rect = joyArea.getBoundingClientRect();
            dragOffset.x = touch.clientX - rect.left;
            dragOffset.y = touch.clientY - rect.top;
            e.preventDefault();
        }, { passive: false });
    }

    // Drag and tap handlers for buttons
    document.querySelectorAll('.customize-btn').forEach(btn => {
        // Tap to edit
        btn.addEventListener('click', (e) => {
            if (!dragTarget) {
                openControlEditPopup(btn.dataset.control, btn);
            }
        });

        // Drag to move
        btn.addEventListener('touchstart', (e) => {
            if (e.target.closest('#controlEditPopup')) return;
            dragTarget = btn;
            const touch = e.touches[0];
            const rect = btn.getBoundingClientRect();
            dragOffset.x = touch.clientX - rect.left;
            dragOffset.y = touch.clientY - rect.top;
            e.preventDefault();
        }, { passive: false });
    });

    // Touch move handler
    document.addEventListener('touchmove', (e) => {
        if (!dragTarget || !customizeMode) return;
        if (e.target.closest('#controlEditPopup')) return;

        const touch = e.touches[0];
        const x = touch.clientX - dragOffset.x;
        const y = window.innerHeight - touch.clientY - (dragTarget.offsetHeight - dragOffset.y);

        dragTarget.style.left = x + 'px';
        dragTarget.style.bottom = Math.max(0, y) + 'px';

        // Save position
        if (dragTarget.id === 'customizeJoystickArea') {
            mobileConfig.joystickX = x;
            mobileConfig.joystickY = Math.max(0, y);
        } else {
            const control = dragTarget.dataset.control;
            if (control === 'jump') { mobileConfig.jumpX = x; mobileConfig.jumpY = Math.max(0, y); }
            else if (control === 'attack') { mobileConfig.attackX = x; mobileConfig.attackY = Math.max(0, y); }
            else if (control === 'dash') { mobileConfig.dashX = x; mobileConfig.dashY = Math.max(0, y); }
            else if (control === 'shatter') { mobileConfig.shatterX = x; mobileConfig.shatterY = Math.max(0, y); }
        }

        e.preventDefault();
    }, { passive: false });

    // Touch end handler
    document.addEventListener('touchend', (e) => {
        if (dragTarget) {
            setTimeout(() => { dragTarget = null; }, 100);
        }
    });

    // Mouse support for testing on PC
    let mouseDown = false;
    document.addEventListener('mousedown', (e) => {
        if (!customizeMode) return;
        if (e.target.closest('#controlEditPopup')) return;

        const joyArea = document.getElementById('customizeJoystickArea');
        const btn = e.target.closest('.customize-btn');

        if (joyArea && joyArea.contains(e.target)) {
            dragTarget = joyArea;
            const rect = joyArea.getBoundingClientRect();
            dragOffset.x = e.clientX - rect.left;
            dragOffset.y = e.clientY - rect.top;
            mouseDown = true;
        } else if (btn) {
            dragTarget = btn;
            const rect = btn.getBoundingClientRect();
            dragOffset.x = e.clientX - rect.left;
            dragOffset.y = e.clientY - rect.top;
            mouseDown = true;
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragTarget || !customizeMode || !mouseDown) return;

        const x = e.clientX - dragOffset.x;
        const y = window.innerHeight - e.clientY - (dragTarget.offsetHeight - dragOffset.y);

        dragTarget.style.left = x + 'px';
        dragTarget.style.bottom = Math.max(0, y) + 'px';

        if (dragTarget.id === 'customizeJoystickArea') {
            mobileConfig.joystickX = x;
            mobileConfig.joystickY = Math.max(0, y);
        } else {
            const control = dragTarget.dataset.control;
            if (control === 'jump') { mobileConfig.jumpX = x; mobileConfig.jumpY = Math.max(0, y); }
            else if (control === 'attack') { mobileConfig.attackX = x; mobileConfig.attackY = Math.max(0, y); }
            else if (control === 'dash') { mobileConfig.dashX = x; mobileConfig.dashY = Math.max(0, y); }
            else if (control === 'shatter') { mobileConfig.shatterX = x; mobileConfig.shatterY = Math.max(0, y); }
        }
    });

    document.addEventListener('mouseup', () => {
        mouseDown = false;
        dragTarget = null;
    });
}

function updateMobileControlsVisibility() {
    if (!isTouchDevice) return;

    const mobileControls = document.getElementById('mobileControls');
    const isPlaying = (typeof state !== 'undefined' && (state === 'playing' || state === 'announce'));
    const isPortrait = window.innerHeight > window.innerWidth;

    // Show controls only during gameplay
    if (isPlaying && !customizeMode) {
        mobileControls.classList.add('visible');
        // Show rotate overlay in portrait mode during gameplay
        if (isPortrait) {
            document.body.classList.add('show-rotate');
        } else {
            document.body.classList.remove('show-rotate');
        }
    } else {
        mobileControls.classList.remove('visible');
        document.body.classList.remove('show-rotate');
    }
}

function initMobileControls() {
    if (!isTouchDevice) return;

    loadMobileConfig();
    applyMobileConfig();
    initCustomizeControls();

    const joystickArea = document.getElementById('joystickArea');
    const joystickThumb = document.getElementById('joystickThumb');
    const actionButtons = document.querySelectorAll('.touch-btn');

    // Joystick touch handlers - improved to prevent double input
    joystickArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
        // Prevent double registration - check if already active
        if (touchJoystickActive) return;
        const touch = e.changedTouches[0];
        touchJoystickActive = true;
        touchJoystickId = touch.identifier;
        const rect = joystickArea.getBoundingClientRect();
        touchJoystickStart = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    }, { passive: false });

    joystickArea.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!touchJoystickActive) return;

        for (let touch of e.changedTouches) {
            if (touch.identifier !== touchJoystickId) continue;

            const dx = touch.clientX - touchJoystickStart.x;
            const dy = touch.clientY - touchJoystickStart.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Scale max distance by joystick size
            const maxDist = (mobileConfig.joystickSize * 0.35);
            const clampedDist = Math.min(dist, maxDist);
            const angle = Math.atan2(dy, dx);
            const thumbX = Math.cos(angle) * clampedDist;
            const thumbY = Math.sin(angle) * clampedDist;

            joystickThumb.style.transform = `translate(calc(-50% + ${thumbX}px), calc(-50% + ${thumbY}px))`;

            // Set movement keys based on joystick position
            const leftCode = P1KEYS.left;
            const rightCode = P1KEYS.right;
            const deadzone = JOYSTICK_DEADZONE;

            if (dist > deadzone) {
                if (dx < -deadzone) {
                    keys[leftCode] = true;
                    keys[rightCode] = false;
                } else if (dx > deadzone) {
                    keys[rightCode] = true;
                    keys[leftCode] = false;
                } else {
                    keys[leftCode] = false;
                    keys[rightCode] = false;
                }
            } else {
                keys[leftCode] = false;
                keys[rightCode] = false;
            }
        }
    }, { passive: false });

    joystickArea.addEventListener('touchend', (e) => {
        e.preventDefault();
        for (let touch of e.changedTouches) {
            if (touch.identifier !== touchJoystickId) continue;
            touchJoystickActive = false;
            touchJoystickId = null;
            joystickThumb.style.transform = 'translate(-50%, -50%)';

            // Release movement keys
            keys[P1KEYS.left] = false;
            keys[P1KEYS.right] = false;
        }
    }, { passive: false });

    joystickArea.addEventListener('touchcancel', (e) => {
        touchJoystickActive = false;
        touchJoystickId = null;
        joystickThumb.style.transform = 'translate(-50%, -50%)';
        keys[P1KEYS.left] = false;
        keys[P1KEYS.right] = false;
    });

    // Action button touch handlers - improved to prevent double input
    actionButtons.forEach(btn => {
        const action = btn.dataset.action;
        if (!action || typeof P1KEYS === 'undefined' || !P1KEYS[action]) return;

        const keyCode = P1KEYS[action];
        const touchKey = 'btn_' + action;

        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            // Prevent double registration
            if (activeButtonTouches[touchKey]) return;
            activeButtonTouches[touchKey] = true;
            if (typeof justPressed !== 'undefined') justPressed[keyCode] = true;
            keys[keyCode] = true;
            btn.classList.add('pressed');
        }, { passive: false });

        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            delete activeButtonTouches[touchKey];
            keys[keyCode] = false;
            btn.classList.remove('pressed');
        }, { passive: false });

        btn.addEventListener('touchcancel', (e) => {
            delete activeButtonTouches[touchKey];
            keys[keyCode] = false;
            btn.classList.remove('pressed');
        });
    });

    // Update visibility on orientation change
    window.addEventListener('resize', updateMobileControlsVisibility);
    window.addEventListener('orientationchange', updateMobileControlsVisibility);
}

// Initialize mobile controls on page load
if (isTouchDevice) {
    document.body.classList.add('is-mobile');
    window.addEventListener('load', () => {
        loadMobileConfig();
        initMobileControls();
    });
}

// Export for use in main game
window.isTouchDevice = isTouchDevice;
window.MOBILE_LERP_FACTOR = MOBILE_LERP_FACTOR;
