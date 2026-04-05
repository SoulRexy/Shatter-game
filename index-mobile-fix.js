// ==================== MOBILE TOUCH CONTROLS =====================
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

let touchJoystickActive = false;
let touchJoystickStart = { x: 0, y: 0 };
let touchJoystickId = null;
let activeButtonTouches = {}; // Track active button touches to prevent double input
const JOYSTICK_DEADZONE = 12;
const JOYSTICK_MAXDIST = 35;

// Default mobile config
const defaultMobileConfig = {
    joystickSize: 100,
    buttonSize: 55,
    joystickSide: 'left',
    joystickX: 10,
    joystickY: 20,
    buttonsX: 10,
    buttonsY: 15
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
    const btnSize = mobileConfig.buttonSize;
    const joySide = mobileConfig.joystickSide;
    const joyX = mobileConfig.joystickX;
    const joyY = mobileConfig.joystickY;
    const btnX = mobileConfig.buttonsX;
    const btnY = mobileConfig.buttonsY;

    // Apply joystick size
    joystickBase.style.width = size + 'px';
    joystickBase.style.height = size + 'px';
    joystickThumb.style.width = (size * 0.4) + 'px';
    joystickThumb.style.height = (size * 0.4) + 'px';
    joystickArea.style.width = (size + 20) + 'px';
    joystickArea.style.height = (size + 20) + 'px';

    // Apply joystick position
    joystickArea.style.bottom = joyY + 'px';
    if (joySide === 'left') {
        joystickArea.style.left = joyX + 'px';
        joystickArea.style.right = 'auto';
    } else {
        joystickArea.style.left = 'auto';
        joystickArea.style.right = joyX + 'px';
    }

    // Apply button sizes
    const buttons = actionButtons.querySelectorAll('.touch-btn');
    buttons.forEach(btn => {
        btn.style.width = btnSize + 'px';
        btn.style.height = btnSize + 'px';
        btn.style.fontSize = Math.max(8, btnSize * 0.15) + 'px';
    });

    // Apply button position
    actionButtons.style.bottom = btnY + 'px';
    if (joySide === 'left') {
        actionButtons.style.left = 'auto';
        actionButtons.style.right = btnX + 'px';
    } else {
        actionButtons.style.left = btnX + 'px';
        actionButtons.style.right = 'auto';
    }
}

// Initialize mobile settings panel
function initMobileSettingsPanel() {
    if (!isTouchDevice) return;

    // Load saved config first
    loadMobileConfig();

    // Set slider values
    document.getElementById('mobileJoystickSize').value = mobileConfig.joystickSize;
    document.getElementById('mobileJoystickSizeVal').textContent = mobileConfig.joystickSize;
    document.getElementById('mobileButtonSize').value = mobileConfig.buttonSize;
    document.getElementById('mobileButtonSizeVal').textContent = mobileConfig.buttonSize;
    document.getElementById('mobileJoystickSide').value = mobileConfig.joystickSide;
    document.getElementById('mobileJoystickX').value = mobileConfig.joystickX;
    document.getElementById('mobileJoystickXVal').textContent = mobileConfig.joystickX;
    document.getElementById('mobileJoystickY').value = mobileConfig.joystickY;
    document.getElementById('mobileJoystickYVal').textContent = mobileConfig.joystickY;
    document.getElementById('mobileButtonsX').value = mobileConfig.buttonsX;
    document.getElementById('mobileButtonsXVal').textContent = mobileConfig.buttonsX;
    document.getElementById('mobileButtonsY').value = mobileConfig.buttonsY;
    document.getElementById('mobileButtonsYVal').textContent = mobileConfig.buttonsY;

    // Add event listeners for sliders
    document.getElementById('mobileJoystickSize').addEventListener('input', (e) => {
        mobileConfig.joystickSize = parseInt(e.target.value);
        document.getElementById('mobileJoystickSizeVal').textContent = mobileConfig.joystickSize;
        saveMobileConfig();
        applyMobileConfig();
    });

    document.getElementById('mobileButtonSize').addEventListener('input', (e) => {
        mobileConfig.buttonSize = parseInt(e.target.value);
        document.getElementById('mobileButtonSizeVal').textContent = mobileConfig.buttonSize;
        saveMobileConfig();
        applyMobileConfig();
    });

    document.getElementById('mobileJoystickSide').addEventListener('change', (e) => {
        mobileConfig.joystickSide = e.target.value;
        saveMobileConfig();
        applyMobileConfig();
    });

    document.getElementById('mobileJoystickX').addEventListener('input', (e) => {
        mobileConfig.joystickX = parseInt(e.target.value);
        document.getElementById('mobileJoystickXVal').textContent = mobileConfig.joystickX;
        saveMobileConfig();
        applyMobileConfig();
    });

    document.getElementById('mobileJoystickY').addEventListener('input', (e) => {
        mobileConfig.joystickY = parseInt(e.target.value);
        document.getElementById('mobileJoystickYVal').textContent = mobileConfig.joystickY;
        saveMobileConfig();
        applyMobileConfig();
    });

    document.getElementById('mobileButtonsX').addEventListener('input', (e) => {
        mobileConfig.buttonsX = parseInt(e.target.value);
        document.getElementById('mobileButtonsXVal').textContent = mobileConfig.buttonsX;
        saveMobileConfig();
        applyMobileConfig();
    });

    document.getElementById('mobileButtonsY').addEventListener('input', (e) => {
        mobileConfig.buttonsY = parseInt(e.target.value);
        document.getElementById('mobileButtonsYVal').textContent = mobileConfig.buttonsY;
        saveMobileConfig();
        applyMobileConfig();
    });

    // Reset button
    document.getElementById('mobileResetBtn').addEventListener('click', () => {
        mobileConfig = { ...defaultMobileConfig };
        saveMobileConfig();
        initMobileSettingsPanel();
        applyMobileConfig();
    });
}

function updateMobileControlsVisibility() {
    if (!isTouchDevice) return;

    const mobileControls = document.getElementById('mobileControls');
    const isPlaying = (typeof state !== 'undefined' && (state === 'playing' || state === 'announce'));
    const isPortrait = window.innerHeight > window.innerWidth;

    // Show controls only during gameplay
    if (isPlaying) {
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
    initMobileSettingsPanel();

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
        }, { passive: false })

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
