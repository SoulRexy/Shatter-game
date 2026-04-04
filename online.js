// ===================== ONLINE MANAGER =====================
// Client-side socket.io module for SHATTER online multiplayer

const OnlineManager = (function() {
    let socket = null;
    let connected = false;
    let inQueue = false;
    let inMatch = false;
    let latency = 0;
    let lastPingTime = 0;

    // Callbacks
    let onMatchFoundCb = null;
    let onOpponentInputCb = null;
    let onDisconnectCb = null;
    let onReconnectCb = null;
    let onOpponentLeftCb = null;
    let onQueueUpdateCb = null;
    let onBannedCb = null;
    let onKickedCb = null;
    let onAnnouncementCb = null;
    let onAccountDeletedCb = null;
    let onServerRestartingCb = null;
    let onAuthFailedCb = null;
    let onRenamedCb = null;
    let onChatMessageCb = null;
    let onChatHistoryCb = null;
    let onChatPingCb = null;
    let onRoleChangedCb = null;
    let onChatMutedCb = null;
    let onChatErrorCb = null;
    let onAuthenticatedCb = null;
    let onDMCb = null;
    let onFriendRequestCb = null;
    let onFriendAcceptedCb = null;
    let onDamageTakenCb = null;

    let pingInterval = null;
    let savedUsername = null;
    let savedToken = null;

    function connect() {
        // Check if socket.io is available (use window.io to avoid shadowing issues)
        if (typeof window.io !== 'function') {
            console.warn('[Online] Socket.io not loaded - server may be offline');
            return Promise.reject(new Error('Server offline'));
        }

        if (socket && socket.connected) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            // Clean up old socket if exists
            if (socket) {
                socket.removeAllListeners();
                socket.disconnect();
                socket = null;
            }

            try {
                // Optimized socket options for low-latency real-time gaming
                socket = window.io({
                    transports: ['websocket'],  // Force WebSocket, no polling fallback
                    upgrade: false,              // Skip HTTP long-polling upgrade
                    rememberUpgrade: false,
                    reconnection: true,
                    reconnectionAttempts: 5,
                    reconnectionDelay: 500,
                    timeout: 5000
                });
            } catch (e) {
                console.error('[Online] Failed to create socket:', e);
                reject(e);
                return;
            }

            socket.on('connect', () => {
                connected = true;
                console.log('[Online] Connected to server');
                startPing();
                resolve();
            });

            socket.on('disconnect', () => {
                connected = false;
                inQueue = false;
                console.log('[Online] Disconnected from server');
            });

            socket.on('connect_error', (err) => {
                console.error('[Online] Connection error:', err);
                reject(err);
            });

            socket.on('authenticated', () => {
                console.log('[Online] Authenticated');
                if (onAuthenticatedCb) onAuthenticatedCb();
            });

            socket.on('authFailed', (data) => {
                console.error('[Online] Auth failed:', data);
                if (onAuthFailedCb) onAuthFailedCb(data);
            });

            socket.on('matchFound', (data) => {
                inQueue = false;
                inMatch = true;
                console.log('[Online] Match found:', data);
                if (onMatchFoundCb) onMatchFoundCb(data);
            });

            socket.on('matchCancelled', () => {
                inQueue = false;
                console.log('[Online] Match search cancelled');
            });

            socket.on('opponentInput', (data) => {
                if (onOpponentInputCb) {
                    onOpponentInputCb(data);
                }
            });

            socket.on('opponentDisconnected', () => {
                console.log('[Online] Opponent disconnected');
                if (onDisconnectCb) onDisconnectCb();
            });

            socket.on('opponentReconnected', () => {
                console.log('[Online] Opponent reconnected');
                if (onReconnectCb) onReconnectCb();
            });

            socket.on('opponentLeft', () => {
                console.log('[Online] Opponent left the match');
                inMatch = false;
                if (onOpponentLeftCb) onOpponentLeftCb();
            });

            socket.on('reconnected', () => {
                inMatch = true;
                console.log('[Online] Reconnected to match');
            });

            socket.on('reconnectFailed', () => {
                console.log('[Online] Reconnection failed');
            });

            socket.on('pongCheck', (timestamp) => {
                latency = Date.now() - timestamp;
            });

            // Admin events
            socket.on('banned', (data) => {
                console.log('[Online] Banned:', data);
                if (onBannedCb) onBannedCb(data);
            });

            socket.on('kicked', (data) => {
                console.log('[Online] Kicked:', data);
                if (onKickedCb) onKickedCb(data);
            });

            socket.on('announcement', (data) => {
                console.log('[Online] Announcement:', data);
                if (onAnnouncementCb) onAnnouncementCb(data);
            });

            socket.on('accountDeleted', () => {
                console.log('[Online] Account deleted by admin');
                if (onAccountDeletedCb) onAccountDeletedCb();
            });

            socket.on('serverRestarting', (data) => {
                console.log('[Online] Server restarting:', data);
                if (onServerRestartingCb) onServerRestartingCb(data);
            });

            socket.on('renamed', (data) => {
                console.log('[Online] Renamed:', data);
                if (onRenamedCb) onRenamedCb(data);
            });

            socket.on('chatMessage', (data) => {
                if (onChatMessageCb) onChatMessageCb(data);
            });

            socket.on('chatHistory', (data) => {
                if (onChatHistoryCb) onChatHistoryCb(data);
            });

            socket.on('chatPing', (data) => {
                console.log('[Online] Pinged by:', data.from);
                if (onChatPingCb) onChatPingCb(data);
            });

            socket.on('roleChanged', (data) => {
                console.log('[Online] Role changed:', data);
                if (onRoleChangedCb) onRoleChangedCb(data);
            });

            socket.on('chatMuted', (data) => {
                console.log('[Online] Chat muted:', data);
                if (onChatMutedCb) onChatMutedCb(data);
            });

            socket.on('chatError', (data) => {
                console.error('[Online] Chat error:', data);
                // Try to re-authenticate if we have saved credentials
                if (savedUsername && savedToken && socket.connected) {
                    console.log('[Online] Re-authenticating...');
                    socket.emit('authenticate', { username: savedUsername, token: savedToken });
                }
                if (onChatErrorCb) onChatErrorCb(data);
            });

            // DMs and Friends
            socket.on('dm', (data) => {
                console.log('[Online] DM received:', data);
                if (onDMCb) onDMCb(data);
            });

            socket.on('friendRequest', (data) => {
                console.log('[Online] Friend request:', data);
                if (onFriendRequestCb) onFriendRequestCb(data);
            });

            socket.on('friendAccepted', (data) => {
                console.log('[Online] Friend accepted:', data);
                if (onFriendAcceptedCb) onFriendAcceptedCb(data);
            });

            socket.on('queueUpdate', (data) => {
                if (onQueueUpdateCb) onQueueUpdateCb(data);
            });

            socket.on('queuePlayers', (players) => {
                if (typeof window.updateQueueDisplay === 'function') window.updateQueueDisplay(players);
            });

            // Damage synchronization
            socket.on('takeDamage', (data) => {
                console.log('[Online] Damage taken:', data);
                if (onDamageTakenCb) onDamageTakenCb(data);
            });
        });
    }

    function startPing() {
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (socket && socket.connected) {
                socket.emit('pingCheck', Date.now());
            }
        }, 2000);
    }

    function authenticate(username, token) {
        if (!socket || !socket.connected) return;
        savedUsername = username;
        savedToken = token;
        socket.emit('authenticate', { username, token });
    }

    function findMatch(mode) {
        if (!socket || !socket.connected) return;
        inQueue = true;
        socket.emit('findMatch', mode);
    }

    function cancelMatch() {
        if (!socket || !socket.connected) return;
        inQueue = false;
        socket.emit('cancelMatch');
    }

    function sendInput(frame, keyArr, jpArr) {
        if (!socket || !socket.connected) return;
        if (!inMatch) return;
        socket.emit('inputFrame', { f: frame, k: keyArr, jp: jpArr });
    }

    function sendDamage(damage, kx, ky, combo) {
        if (!socket || !socket.connected || !inMatch) return;
        console.log('[Online] Sending damage:', { damage, kx, ky });
        socket.emit('dealDamage', { damage, kx, ky, combo });
    }

    function leaveMatch() {
        if (!socket || !socket.connected) return;
        inMatch = false;
        socket.emit('leaveMatch');
    }

    function disconnect() {
        if (socket) {
            socket.removeAllListeners();
            socket.disconnect();
            socket = null;
        }
        connected = false;
        inQueue = false;
        inMatch = false;
        if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    }

    function adminSubscribe(token) {
        if (!socket || !socket.connected) return;
        socket.emit('adminSubscribe', token);
    }

    // Event registration
    function onMatchFound(cb) { onMatchFoundCb = cb; }
    function onOpponentInput(cb) { onOpponentInputCb = cb; }
    function onDisconnect(cb) { onDisconnectCb = cb; }
    function onReconnect(cb) { onReconnectCb = cb; }
    function onOpponentLeft(cb) { onOpponentLeftCb = cb; }
    function onQueueUpdate(cb) { onQueueUpdateCb = cb; }
    function onBanned(cb) { onBannedCb = cb; }
    function onKicked(cb) { onKickedCb = cb; }
    function onAnnouncement(cb) { onAnnouncementCb = cb; }
    function onAccountDeleted(cb) { onAccountDeletedCb = cb; }
    function onServerRestarting(cb) { onServerRestartingCb = cb; }
    function onAuthFailed(cb) { onAuthFailedCb = cb; }
    function onAuthenticated(cb) { onAuthenticatedCb = cb; }
    function onRenamed(cb) { onRenamedCb = cb; }
    function onChatMessage(cb) { onChatMessageCb = cb; }
    function onChatHistory(cb) { onChatHistoryCb = cb; }
    function onChatPing(cb) { onChatPingCb = cb; }
    function onRoleChanged(cb) { onRoleChangedCb = cb; }
    function onChatMuted(cb) { onChatMutedCb = cb; }
    function onChatError(cb) { onChatErrorCb = cb; }
    function onDM(cb) { onDMCb = cb; }
    function onFriendRequest(cb) { onFriendRequestCb = cb; }
    function onFriendAccepted(cb) { onFriendAcceptedCb = cb; }
    function onDamageTaken(cb) { onDamageTakenCb = cb; }

    function sendChat(message, replyTo) {
        if (!socket || !socket.connected) {
            console.warn('[Online] Cannot send chat - not connected');
            return false;
        }
        socket.emit('chatMessage', { message, replyTo: replyTo || null });
        return true;
    }

    function isConnected() { return connected && socket && socket.connected; }
    function getLatency() { return latency; }
    function isInQueue() { return inQueue; }
    function isInMatch() { return inMatch; }

    function getQueuePlayers(callback) {
        if (!socket || !socket.connected) {
            callback(null);
            return;
        }
        socket.emit('getQueuePlayers');
        // Store callback for response
        if (callback) {
            socket.once('queuePlayers', callback);
        }
    }

    function findRankedMatch(mode) {
        if (!socket || !socket.connected) return;
        inQueue = true;
        socket.emit('findMatch', { mode: mode, ranked: true });
    }

    function findCasualMatch(mode) {
        if (!socket || !socket.connected) return;
        inQueue = true;
        socket.emit('findMatch', { mode: mode, ranked: false });
    }

    return {
        connect, authenticate, findMatch, cancelMatch, sendInput, sendDamage,
        leaveMatch, disconnect, adminSubscribe,
        onMatchFound, onOpponentInput, onDisconnect, onReconnect,
        onOpponentLeft, onQueueUpdate,
        onBanned, onKicked, onAnnouncement, onAccountDeleted,
        onServerRestarting, onAuthFailed, onAuthenticated, onRenamed,
        onChatMessage, onChatHistory, onChatPing, onRoleChanged, onChatMuted, onChatError, sendChat,
        onDM, onFriendRequest, onFriendAccepted, onDamageTaken,
        isConnected, getLatency, isInQueue, isInMatch, getQueuePlayers,
        findRankedMatch, findCasualMatch
    };
})();
