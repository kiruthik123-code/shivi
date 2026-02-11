import { io } from "socket.io-client";

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
const PRODUCTION_SERVER_URL = "https://your-server-name.onrender.com"; // Replace this later!
const socket = io(isLocal ? `${window.location.protocol}//${window.location.hostname}:3000` : PRODUCTION_SERVER_URL);

socket.on("connect", () => {
    console.log("Connected to server with ID:", socket.id);
});

socket.on("connect_error", (error) => {
    console.error("Connection Error:", error);
    showNotification("Failed to connect to game server. Make sure the backend is running!", "error");
});

// State
let myPlayer = null;
let allPlayers = {};
let market = [];
let gameStarted = false;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const loginForm = document.getElementById('login-form');
const notificationArea = document.getElementById('notification-area');

// Constants
const SYSTEM_SHOP = { rice: 2, meat: 3, water_raw: 1, plastic: 1, bread: 2, chemical: 4 };
const RECIPES = {
    water_vendor: { plastic: 1, water_raw: 1, output: 'water', icon: 'water_drop' },
    hotdog_vendor: { bread: 1, meat: 1, output: 'hotdog', icon: 'fastfood' },
    chicken_rice_vendor: { rice: 2, meat: 1, water_raw: 1, output: 'chicken_rice', icon: 'restaurant' },
    medicine_vendor: { chemical: 2, output: 'medicine', icon: 'medication' }
};
const ITEM_EMOJIS = {
    rice: '🌾', meat: '🥩', water_raw: '🚫', plastic: '🧪', bread: '🍞', chemical: '⚗️',
    water: '💧', hotdog: '🌭', chicken_rice: '🍛', medicine: '💊'
};

// Login
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('player-name').value;
    const businessType = document.querySelector('input[name="businessType"]:checked').value;
    socket.emit('join', { name, businessType });
});

socket.on('joined', ({ player, gameStarted: serverGameStarted, roundEndTime }) => {
    myPlayer = player;
    gameStarted = serverGameStarted;
    loginScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    updateBusinessUIData();
    renderShop();
    if (roundEndTime) startTimer(roundEndTime);

    if (player.name.toLowerCase().includes('admin')) {
        document.getElementById('admin-tab-link').classList.remove('hidden');
    }
});

// Tab Switching
document.querySelectorAll('.tab-link').forEach(link => {
    link.addEventListener('click', () => {
        document.querySelectorAll('.tab-link').forEach(l => {
            l.classList.remove('active', 'bg-primary', 'text-white');
            l.classList.add('text-slate-400');
        });
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));

        link.classList.add('active', 'bg-primary', 'text-white');
        link.classList.remove('text-slate-400');
        document.getElementById(link.dataset.tab).classList.remove('hidden');
    });
});

// Notifications
function showNotification(message, type = 'info') {
    const div = document.createElement('div');
    div.className = `notification glass border-l-4 ${type === 'error' ? 'border-rose-500' : 'border-primary'} p-4 mb-2 rounded-lg text-sm shadow-xl animate-bounce`;
    div.textContent = message;
    notificationArea.appendChild(div);
    setTimeout(() => div.remove(), 5000);
}

socket.on('notification', ({ message, type }) => {
    showNotification(message, type);
});

// Game State Updates
socket.on('stateUpdate', ({ players, market: serverMarket }) => {
    allPlayers = players;
    market = serverMarket;
    myPlayer = players[socket.id] || myPlayer;

    renderAll();
});

function renderAll() {
    if (!myPlayer) return;

    // Header & Global Stats
    document.getElementById('header-money').textContent = `$${myPlayer.money.toLocaleString()}`;
    const statusText = document.getElementById('player-status-text');
    statusText.textContent = myPlayer.alive ? 'ALIVE' : 'DEAD';
    document.getElementById('player-status-badge').className = myPlayer.alive ? 'w-2 h-2 rounded-full bg-white animate-ping' : 'w-2 h-2 rounded-full bg-slate-400';

    document.getElementById('active-players-count').textContent = Object.keys(allPlayers).length;
    const totalMoney = Object.values(allPlayers).reduce((sum, p) => sum + p.money, 0);
    document.getElementById('global-bank').textContent = `$${totalMoney.toLocaleString()}`;

    // Stats / Vitals
    updateVitals();

    // Market
    renderMarket();
    populateSellSelect();

    // Inventory
    renderInventory();

    // Admin
    renderAdmin();
}

function updateVitals() {
    const vitals = ['health', 'hunger', 'thirst'];
    vitals.forEach(stat => {
        const val = myPlayer[stat];
        const gauge = document.getElementById(`${stat}-gauge`);
        const text = document.getElementById(`${stat}-val`);
        if (gauge && text) {
            // Dasharray is 176. Offset: 176 - (176 * val / 100)
            const offset = 176 - (176 * val / 100);
            gauge.style.strokeDashoffset = offset;
            text.textContent = `${stat.charAt(0).toUpperCase() + stat.slice(1)} ${val}%`;
        }
    });
}

function renderShop() {
    const container = document.getElementById('system-shop-items');
    if (!container) return;
    container.innerHTML = '';

    Object.entries(SYSTEM_SHOP).forEach(([item, price]) => {
        const card = document.createElement('div');
        card.className = 'p-3 rounded-xl bg-slate-800/40 border border-white/5 flex flex-col items-center group hover:bg-slate-800/60 transition-all cursor-pointer';
        card.innerHTML = `
            <span class="text-2xl mb-1 group-hover:scale-110 transition-transform">${ITEM_EMOJIS[item]}</span>
            <span class="text-[11px] font-bold text-slate-400 capitalize">${item.replace('_', ' ')}</span>
            <span class="text-sm font-extrabold text-emerald-400 mb-2">$${price}</span>
            <div class="flex gap-1 w-full">
                <button class="flex-1 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[10px] font-bold" onclick="window.buyRaw('${item}', 1)">+1</button>
                <button class="flex-1 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[10px] font-bold" onclick="window.buyRaw('${item}', 10)">+10</button>
            </div>
        `;
        container.appendChild(card);
    });
}

window.buyRaw = (material, quantity) => {
    socket.emit('buyRaw', { material, quantity });
};

function updateBusinessUIData() {
    const recipe = RECIPES[myPlayer.businessType];
    document.getElementById('business-display-name').textContent = myPlayer.businessType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    document.getElementById('business-icon').textContent = recipe.icon;

    const info = document.getElementById('recipe-info');
    let html = `<div class="flex justify-between text-xs font-medium mb-2"><span class="text-slate-500">Requirements:</span><span class="text-slate-300">`;
    const reqs = Object.entries(recipe).filter(([k]) => k !== 'output' && k !== 'icon').map(([mat, qty]) => `${qty}x ${mat.replace('_', ' ')}`).join(', ');
    html += reqs + `</span></div>`;
    html += `
        <div class="grid grid-cols-2 gap-2 mt-4">
            <button class="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-xs transition-all border border-transparent hover:border-white/5" onclick="window.buyMaterialsFor(1)">Buy 1x</button>
            <button class="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-xs transition-all border border-transparent hover:border-white/5" onclick="window.buyMaterialsFor(10)">Buy 10x</button>
        </div>
    `;
    info.innerHTML = html;
}

window.buyMaterialsFor = (targetQty) => {
    const recipe = RECIPES[myPlayer.businessType];
    Object.entries(recipe).forEach(([mat, qty]) => {
        if (mat !== 'output' && mat !== 'icon') {
            socket.emit('buyRaw', { material: mat, quantity: qty * targetQty });
        }
    });
};

document.getElementById('produce-btn').addEventListener('click', () => {
    socket.emit('produce');
});

function renderInventory() {
    const rawList = document.getElementById('raw-materials-list');
    const finishedList = document.getElementById('finished-goods-list');
    const purchasedList = document.getElementById('purchased-goods-list');

    rawList.innerHTML = '';
    Object.entries(myPlayer.inventory.rawMaterials).forEach(([item, qty]) => {
        if (qty > 0) rawList.appendChild(createItemCard(item, qty, 'amber'));
    });

    finishedList.innerHTML = '';
    Object.entries(myPlayer.inventory.finishedGoods).forEach(([item, qty]) => {
        if (qty > 0) finishedList.appendChild(createItemCard(item, qty, 'blue'));
    });

    purchasedList.innerHTML = '';
    Object.entries(myPlayer.inventory.purchasedGoods).forEach(([item, qty]) => {
        if (qty > 0) {
            const card = createItemCard(item, qty, 'pink');
            const btn = document.createElement('button');
            btn.className = 'text-[9px] font-black uppercase tracking-widest text-pink-400 bg-white/5 px-2 py-1 rounded hover:bg-pink-500 hover:text-white transition-all w-full mt-1';
            btn.textContent = 'Consume';
            btn.onclick = () => socket.emit('consume', { item });
            card.appendChild(btn);
            purchasedList.appendChild(card);
        }
    });

    if (rawList.children.length === 0) rawList.innerHTML = '<p class="text-[10px] text-slate-600 font-bold uppercase tracking-wider">Empty</p>';
    if (finishedList.children.length === 0) finishedList.innerHTML = '<p class="text-[10px] text-slate-600 font-bold uppercase tracking-wider">Empty</p>';
    if (purchasedList.children.length === 0) purchasedList.innerHTML = '<p class="text-[10px] text-slate-600 font-bold uppercase tracking-wider">Empty</p>';
}

function createItemCard(item, qty, color) {
    const div = document.createElement('div');
    div.className = `aspect-square glass bg-${color}-500/10 rounded-2xl border border-${color}-500/20 flex flex-col items-center justify-center gap-1 group hover:border-${color}-400/50 transition-all cursor-pointer`;
    div.innerHTML = `
        <span class="text-3xl">${ITEM_EMOJIS[item]}</span>
        <span class="text-[10px] font-bold text-${color}-300 capitalize">${item.replace('_', ' ')}</span>
        <span class="text-xs font-black text-white px-2 py-0.5 bg-${color}-500/30 rounded-full">x${qty}</span>
    `;
    return div;
}

// Market
function renderMarket() {
    const container = document.getElementById('market-list-container');
    container.innerHTML = '';

    if (market.length === 0) {
        container.innerHTML = '<div class="col-span-full py-20 flex flex-col items-center justify-center text-slate-500"><span class="material-icons text-6xl mb-4 opacity-20">inventory</span><p class="text-xl font-medium">No active listings available.</p></div>';
        return;
    }

    market.forEach(listing => {
        const recipe = Object.values(RECIPES).find(r => r.output === listing.item);
        const icon = recipe ? recipe.icon : 'inventory';

        const card = document.createElement('div');
        card.className = 'bg-card-dark border border-slate-800 rounded-2xl p-5 hover:border-primary/50 transition-all group relative overflow-hidden';
        card.innerHTML = `
            <div class="flex items-start justify-between mb-4">
                <div class="flex items-center space-x-3">
                    <div class="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center">
                        <span class="material-icons text-blue-500">${icon}</span>
                    </div>
                    <div>
                        <h3 class="font-bold capitalize">${listing.item.replace('_', ' ')}</h3>
                        <span class="text-xs text-slate-500">Seller: <span class="text-blue-400">@${listing.sellerName}</span></span>
                    </div>
                </div>
                <div class="text-right">
                    <span class="block text-xs text-slate-500 uppercase font-bold tracking-tight">Price Each</span>
                    <span class="text-lg font-bold text-green-500">$${listing.price}</span>
                </div>
            </div>
            <div class="flex items-center justify-between mb-5 bg-slate-900/50 rounded-xl p-3">
                <div class="text-center flex-1 border-r border-slate-800">
                    <span class="block text-[10px] text-slate-500 uppercase">Available</span>
                    <span class="text-sm font-bold">${listing.quantity} Units</span>
                </div>
                <div class="text-center flex-1">
                    <span class="block text-[10px] text-slate-500 uppercase">Total Value</span>
                    <span class="text-sm font-bold">$${listing.quantity * listing.price}</span>
                </div>
            </div>
            ${listing.sellerId !== socket.id ? `
                <div class="flex gap-2">
                    <button class="flex-1 bg-slate-800 hover:bg-primary hover:text-white text-slate-200 font-bold py-3 rounded-xl transition-all text-sm" onclick="window.buyMarket('${listing.id}', 1)">Buy 1</button>
                    <button class="flex-1 bg-slate-800 hover:bg-primary hover:text-white text-slate-200 font-bold py-3 rounded-xl transition-all text-sm" onclick="window.buyMarket('${listing.id}', ${listing.quantity})">Buy All</button>
                </div>
            ` : '<div class="w-full py-3 bg-slate-800/50 text-slate-500 font-bold rounded-xl text-center text-xs uppercase tracking-widest">Your Listing</div>'}
        `;
        container.appendChild(card);
    });
}

window.buyMarket = (listingId, quantity) => {
    socket.emit('buyMarket', { listingId, quantity });
};

function populateSellSelect() {
    const select = document.getElementById('sell-item');
    const currentVal = select.value;
    select.innerHTML = '<option value="" disabled selected>Select Item</option>';

    Object.entries(myPlayer.inventory.finishedGoods).forEach(([item, qty]) => {
        if (qty > 0) {
            const opt = document.createElement('option');
            opt.value = item;
            opt.textContent = `${item.replace('_', ' ')} (${qty})`;
            select.appendChild(opt);
        }
    });
    if (currentVal) select.value = currentVal;
}

document.getElementById('sell-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const item = document.getElementById('sell-item').value;
    const quantity = parseInt(document.getElementById('sell-qty').value);
    const price = parseInt(document.getElementById('sell-price').value);

    if (item && quantity > 0 && price > 0) {
        socket.emit('listMarket', { item, quantity, price });
        e.target.reset();
    }
});

// Chat
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chatInput.value.trim()) {
        socket.emit('chat', chatInput.value);
        chatInput.value = '';
    }
});

socket.on('chat', ({ name, message }) => {
    const div = document.createElement('div');
    div.className = 'flex flex-col gap-1';
    div.innerHTML = `
        <div class="flex items-center gap-2">
            <span class="text-[11px] font-black text-blue-400">@${name}</span>
            <span class="text-[9px] text-slate-600 font-medium">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <p class="text-xs text-slate-300 bg-white/5 p-2 rounded-lg rounded-tl-none border border-white/5">${message}</p>
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

// Timer
let timerInterval = null;
function startTimer(endTime) {
    if (timerInterval) clearInterval(timerInterval);
    const display = document.getElementById('round-timer');

    timerInterval = setInterval(() => {
        const remaining = endTime - Date.now();
        if (remaining <= 0) {
            display.innerHTML = `<span class="material-symbols-rounded text-sm">timer</span><span class="text-sm tracking-widest uppercase">Round Ended</span>`;
            clearInterval(timerInterval);
            return;
        }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        display.innerHTML = `<span class="material-symbols-rounded text-sm">timer</span><span class="text-sm tracking-widest uppercase">Round Ends In ${mins}:${secs.toString().padStart(2, '0')}</span>`;
    }, 1000);
}

socket.on('roundStarted', ({ roundEndTime }) => {
    startTimer(roundEndTime);
    showNotification('THE ROUND HAS STARTED!', 'info');
});

socket.on('roundEnded', ({ leaderboard }) => {
    gameOverScreen.classList.remove('hidden');
    const container = document.getElementById('leaderboard');
    container.innerHTML = '<h2 class="text-slate-500 uppercase font-bold tracking-[0.2em] mb-6">Final Leaderboard</h2>';
    leaderboard.forEach((p, i) => {
        const item = document.createElement('div');
        item.className = 'flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/5';
        item.innerHTML = `
            <div class="flex items-center gap-4">
                <span class="text-2xl font-black text-slate-600">#${i + 1}</span>
                <span class="font-bold text-lg">${p.name}</span>
            </div>
            <span class="font-mono text-emerald-400 font-black text-xl">$${p.money.toLocaleString()}</span>
        `;
        container.appendChild(item);
    });
});

socket.on('playerDied', ({ id, name }) => {
    showNotification(`${name.toUpperCase()} HAS PERISHED!`, 'error');
    const log = document.getElementById('admin-logs');
    if (log) {
        const div = document.createElement('div');
        div.className = 'flex gap-2 text-rose-400 font-bold';
        div.innerHTML = `<span>[${new Date().toLocaleTimeString()}]</span><span>DEATH: Player ${name} has died.</span>`;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    }
});

// Admin
function renderAdmin() {
    const playerList = document.getElementById('admin-players-list');
    if (!playerList) return;
    playerList.innerHTML = '';

    Object.values(allPlayers).forEach(p => {
        const row = document.createElement('tr');
        row.className = `hover:bg-slate-800/30 transition-colors ${!p.alive ? 'opacity-50' : ''}`;
        row.innerHTML = `
            <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30 text-primary font-bold text-xs">${p.name.substring(0, 2).toUpperCase()}</div>
                    <div>
                        <p class="text-sm font-bold">${p.name}</p>
                        <p class="text-[10px] text-slate-500 font-mono">ID: ${p.id.substring(0, 6)}</p>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4 space-y-2 min-w-[160px]">
                <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden flex gap-0.5">
                    <div class="h-full bg-rose-500" style="width: ${p.health}%"></div>
                </div>
                <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden flex gap-0.5">
                    <div class="h-full bg-amber-500" style="width: ${p.hunger}%"></div>
                </div>
                <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden flex gap-0.5">
                    <div class="h-full bg-sky-500" style="width: ${p.thirst}%"></div>
                </div>
            </td>
            <td class="px-6 py-4">
                <span class="text-sm font-mono font-bold text-emerald-400">$${p.money.toLocaleString()}</span>
            </td>
            <td class="px-6 py-4 text-right space-x-2">
                <div class="flex items-center justify-end gap-2">
                    <input type="number" id="donate-amt-${p.id}" placeholder="$" class="w-16 bg-slate-900 border-none rounded text-[10px] py-1 text-white" min="1">
                    <button class="p-2 text-slate-400 hover:text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-colors" onclick="window.adminDonate('${p.id}')">
                        <span class="material-symbols-outlined text-sm">volunteer_activism</span>
                    </button>
                    ${!p.alive ? `
                        <button class="p-2 text-slate-400 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors" onclick="window.adminRevive('${p.id}')">
                            <span class="material-symbols-outlined text-sm">restart_alt</span>
                        </button>
                    ` : ''}
                </div>
            </td>
        `;
        playerList.appendChild(row);
    });
}

document.getElementById('admin-start-btn').addEventListener('click', () => socket.emit('adminStartRound'));
document.getElementById('admin-end-btn').addEventListener('click', () => socket.emit('adminEndRound'));
window.adminRevive = (playerId) => socket.emit('adminRevive', { playerId });
window.adminDonate = (playerId) => {
    const amtInput = document.getElementById(`donate-amt-${playerId}`);
    const amt = parseInt(amtInput.value);
    if (amt > 0) {
        socket.emit('adminDonate', { playerId, amount: amt });
        amtInput.value = '';
    }
};

// Market Ticker Update on trade
socket.on('tradeOccurred', (trade) => {
    const ticker = document.getElementById('market-ticker');
    const span = document.createElement('span');
    span.className = 'mx-8 text-xs font-medium';
    span.innerHTML = `<span class="text-blue-400">@${trade.buyer}</span> bought ${trade.quantity}x <span class="text-slate-400">${trade.item}</span> for <span class="text-green-500">$${trade.price}</span>`;
    ticker.appendChild(span);

    // Add to admin log
    const log = document.getElementById('admin-logs');
    if (log) {
        const div = document.createElement('div');
        div.className = 'flex gap-2';
        div.innerHTML = `<span>[${new Date().toLocaleTimeString()}]</span><span>TRADE: ${trade.buyer} bought ${trade.quantity}x ${trade.item} from ${trade.seller}</span>`;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    }
});
