import { io } from "socket.io-client";

const socket = io(window.location.origin);

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

    updateBusinessTab();
    renderShop();
    if (roundEndTime) startTimer(roundEndTime);

    // Check for admin (simple check: name includes "admin")
    if (player.name.toLowerCase().includes('admin')) {
        document.getElementById('admin-tab-link').classList.remove('hidden');
    }
});

// Tab Switching
document.querySelectorAll('.tab-link').forEach(link => {
    link.addEventListener('click', () => {
        document.querySelectorAll('.tab-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        link.classList.add('active');
        document.getElementById(link.dataset.tab).classList.add('active');
    });
});

// Notifications
function showNotification(message, type = 'info') {
    const div = document.createElement('div');
    div.className = `notification ${type}`;
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

    // Header
    document.getElementById('header-money').textContent = `$${myPlayer.money}`;
    const badge = document.getElementById('player-status-badge');
    badge.textContent = myPlayer.alive ? 'ALIVE' : 'DEAD';
    badge.className = `badge ${myPlayer.alive ? '' : 'dead'}`;

    // Stats
    document.getElementById('health-bar').style.width = `${myPlayer.health}%`;
    document.getElementById('hunger-bar').style.width = `${myPlayer.hunger}%`;
    document.getElementById('thirst-bar').style.width = `${myPlayer.thirst}%`;

    // Market
    renderMarket();
    populateSellSelect();

    // Inventory
    renderInventory();

    // Admin
    renderAdmin();
}

// Shop
const SYSTEM_SHOP = {
    rice: 2, meat: 3, water_raw: 1, plastic: 1, bread: 2, chemical: 4
};

function renderShop() {
    const container = document.getElementById('system-shop-items');
    if (!container) return;
    container.innerHTML = '';

    const itemEmojis = { rice: '🌾', meat: '🥩', water_raw: '🚱', plastic: '🧪', bread: '🍞', chemical: '⚗️' };

    Object.entries(SYSTEM_SHOP).forEach(([item, price]) => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            <h4 style="font-size: 0.9rem;">${itemEmojis[item] || ''} ${item.replace('_', ' ')}</h4>
            <span class="price" style="font-size: 0.8rem;">$${price}</span>
            <div class="flex gap-1 justify-center">
                <button class="btn-small" style="font-size: 0.7rem; padding: 0.3rem;" onclick="window.buyRaw('${item}', 1)">+1</button>
                <button class="btn-small" style="font-size: 0.7rem; padding: 0.3rem;" onclick="window.buyRaw('${item}', 10)">+10</button>
            </div>
        `;
        container.appendChild(card);
    });
}

window.buyRaw = (material, quantity) => {
    socket.emit('buyRaw', { material, quantity });
};

// Business
const RECIPES = {
    water_vendor: { plastic: 1, water_raw: 1, output: 'water' },
    hotdog_vendor: { bread: 1, meat: 1, output: 'hotdog' },
    chicken_rice_vendor: { rice: 2, meat: 1, water_raw: 1, output: 'chicken_rice' },
    medicine_vendor: { chemical: 2, output: 'medicine' }
};

function updateBusinessTab() {
    const recipeInfo = document.getElementById('recipe-info');
    if (!recipeInfo) return;
    const recipe = RECIPES[myPlayer.businessType];

    let recipeHtml = `<h4 style="font-size: 1rem;">${myPlayer.businessType.replace(/_/g, ' ')}</h4>`;
    recipeHtml += `<ul style="font-size: 0.85rem; margin-top: 5px;">`;
    Object.entries(recipe).forEach(([mat, qty]) => {
        if (mat !== 'output') {
            recipeHtml += `<li>${qty}x ${mat.replace('_', ' ')}</li>`;
        }
    });
    recipeHtml += `</ul><p style="font-size: 0.8rem; color: var(--text-muted);">Fee: $1</p>`;

    recipeHtml += `
        <div class="flex gap-1 mt-2">
            <button class="btn-small" style="font-size: 0.7rem;" onclick="window.buyMaterialsFor(1)">Buy 1x</button>
            <button class="btn-small" style="font-size: 0.7rem;" onclick="window.buyMaterialsFor(10)">Buy 10x</button>
        </div>
    `;

    recipeInfo.innerHTML = recipeHtml;
}

window.buyMaterialsFor = (targetQty) => {
    const recipe = RECIPES[myPlayer.businessType];
    Object.entries(recipe).forEach(([mat, qty]) => {
        if (mat !== 'output') {
            socket.emit('buyRaw', { material: mat, quantity: qty * targetQty });
        }
    });
};

document.getElementById('produce-btn').addEventListener('click', () => {
    socket.emit('produce');
});

// Market
function renderMarket() {
    const container = document.getElementById('market-list-container');
    container.innerHTML = '';

    if (market.length === 0) {
        container.innerHTML = '<p class="text-muted">No listings available.</p>';
        return;
    }

    market.forEach(listing => {
        const card = document.createElement('div');
        card.className = 'listing-card';
        card.innerHTML = `
            <div class="listing-info">
                <h4>${listing.quantity}x ${listing.item.replace('_', ' ')} @ $${listing.price}/ea</h4>
                <p>Seller: ${listing.sellerName}</p>
            </div>
            ${listing.sellerId !== socket.id ? `
                <div class="flex gap-1">
                    <button class="btn-small" onclick="window.buyMarket('${listing.id}', 1)">Buy 1</button>
                    <button class="btn-small" onclick="window.buyMarket('${listing.id}', ${listing.quantity})">Buy All</button>
                </div>
            ` : '<span class="text-muted">Your Listing</span>'}
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

// Inventory
function renderInventory() {
    const rawList = document.getElementById('raw-materials-list');
    const finishedList = document.getElementById('finished-goods-list');
    const purchasedList = document.getElementById('purchased-goods-list');

    rawList.innerHTML = '';
    Object.entries(myPlayer.inventory.rawMaterials).forEach(([item, qty]) => {
        if (qty > 0) rawList.appendChild(createItemCard(item, qty));
    });

    finishedList.innerHTML = '';
    Object.entries(myPlayer.inventory.finishedGoods).forEach(([item, qty]) => {
        if (qty > 0) finishedList.appendChild(createItemCard(item, qty));
    });

    purchasedList.innerHTML = '';
    Object.entries(myPlayer.inventory.purchasedGoods).forEach(([item, qty]) => {
        if (qty > 0) {
            const card = createItemCard(item, qty);
            const btn = document.createElement('button');
            btn.className = 'btn-small w-full mt-2';
            btn.textContent = 'Consume';
            btn.onclick = () => socket.emit('consume', { item });
            card.appendChild(btn);
            purchasedList.appendChild(card);
        }
    });

    if (rawList.children.length === 0) rawList.innerHTML = '<p class="text-muted">Empty</p>';
    if (finishedList.children.length === 0) finishedList.innerHTML = '<p class="text-muted">Empty</p>';
    if (purchasedList.children.length === 0) purchasedList.innerHTML = '<p class="text-muted">Empty</p>';
}

function createItemCard(item, qty) {
    const itemEmojis = {
        rice: '🌾', meat: '🥩', water_raw: '🚱', plastic: '🧪', bread: '🍞', chemical: '⚗️',
        water: '💧', hotdog: '🌭', chicken_rice: '🍛', medicine: '💊'
    };
    const div = document.createElement('div');
    div.className = 'product-card';
    div.innerHTML = `<h4>${itemEmojis[item] || ''} ${item.replace('_', ' ')}</h4><p>Quantity: ${qty}</p>`;
    return div;
}

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
    div.className = 'chat-msg';
    div.innerHTML = `<span class="name">${name}:</span><span>${message}</span>`;
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
            display.textContent = "Round Ended";
            clearInterval(timerInterval);
            return;
        }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        display.textContent = `Time Left: ${mins}:${secs.toString().padStart(2, '0')}`;
    }, 1000);
}

socket.on('roundStarted', ({ roundEndTime }) => {
    startTimer(roundEndTime);
    showNotification('The round has started!');
});

socket.on('roundEnded', ({ leaderboard }) => {
    gameOverScreen.classList.remove('hidden');
    const container = document.getElementById('leaderboard');
    container.innerHTML = '<h2>Final Leaderboard</h2>';
    leaderboard.forEach((p, i) => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        item.innerHTML = `<span>#${i + 1} ${p.name}</span> <span>$${p.money}</span>`;
        container.appendChild(item);
    });
});

socket.on('playerDied', ({ name }) => {
    showNotification(`${name} has died!`, 'error');
});

// Admin
function renderAdmin() {
    const playerList = document.getElementById('admin-players-list');
    playerList.innerHTML = '';

    Object.values(allPlayers).forEach(p => {
        const div = document.createElement('div');
        div.className = 'listing-card';
        div.innerHTML = `
            <div style="flex-grow: 1;">
                <strong>${p.name}</strong> - $${p.money}
                <br><small>H:${p.health} Hu:${p.hunger} T:${p.thirst}</small>
            </div>
            <div class="flex gap-1">
                ${!p.alive ? `<button class="btn-small" onclick="window.adminRevive('${p.id}')">Revive</button>` : ''}
                <input type="number" id="donate-amt-${p.id}" placeholder="$" style="width: 60px; padding: 0.2rem;" min="1">
                <button class="btn-small" onclick="window.adminDonate('${p.id}')">Donate</button>
            </div>
        `;
        playerList.appendChild(div);
    });
}

document.getElementById('admin-start-btn').addEventListener('click', () => socket.emit('adminStartRound'));
document.getElementById('admin-end-btn').addEventListener('click', () => socket.emit('adminEndRound'));
window.adminRevive = (playerId) => socket.emit('adminRevive', { playerId });
window.adminDonate = (playerId) => {
    const amt = parseInt(document.getElementById(`donate-amt-${playerId}`).value);
    if (amt > 0) {
        socket.emit('adminDonate', { playerId, amount: amt });
        document.getElementById(`donate-amt-${playerId}`).value = '';
    }
};
