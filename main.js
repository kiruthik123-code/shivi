import { io } from "socket.io-client";

const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const socket = io(isLocal ? "http://localhost:5000" : "https://shivi-ox1d.onrender.com");

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
let hasAnalyticsUpdate = true;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const loginForm = document.getElementById('login-form');
const notificationArea = document.getElementById('notification-area');

// Constants
const SYSTEM_SHOP = { rice: 2, meat: 3, water_raw: 1, plastic: 1, bread: 2, fruit: 3 };
const RECIPES = {
    water_vendor: { plastic: 1, water_raw: 1, output: 'water', icon: 'water_drop' },
    hotdog_vendor: { bread: 1, meat: 1, output: 'hotdog', icon: 'fastfood' },
    chicken_rice_vendor: { rice: 2, meat: 1, water_raw: 1, output: 'chicken_rice', icon: 'restaurant' },
    juice_vendor: { fruit: 2, water_raw: 1, output: 'juice', icon: 'local_drink' }
};
const ITEM_ICONS = {
    rice: 'grain',
    meat: 'restaurant_menu',
    water_raw: 'opacity',
    plastic: 'science',
    bread: 'bakery_dining',
    fruit: 'nutrition',
    chemical: 'biotech', // kept for safety
    water: 'water_drop',
    hotdog: 'fastfood',
    chicken_rice: 'rice_bowl',
    medicine: 'medication', // kept for safety
    juice: 'local_drink'
};

// ... existing code ...

function renderShop() {
    const container = document.getElementById('system-shop-items');
    if (!container) return;
    container.innerHTML = '';

    // Determine required materials for the current business
    const currentRecipe = RECIPES[myPlayer.businessType];
    const requiredMaterials = currentRecipe ? Object.keys(currentRecipe).filter(k => k !== 'output' && k !== 'icon') : [];

    // Separate items
    const recommendedItems = [];
    const otherItems = [];

    Object.entries(SYSTEM_SHOP).forEach(([item, price]) => {
        if (requiredMaterials.includes(item)) {
            recommendedItems.push({ item, price });
        } else {
            otherItems.push({ item, price });
        }
    });

    const createShopCard = ({ item, price }) => {
        const card = document.createElement('div');
        card.className = 'p-3 rounded-xl bg-slate-800/40 border border-white/5 flex flex-col items-center group hover:bg-slate-800/60 transition-all cursor-pointer';
        card.innerHTML = `
            <span class="material-symbols-rounded text-2xl mb-1 group-hover:scale-110 transition-transform text-slate-300">${ITEM_ICONS[item] || 'inventory_2'}</span>
            <span class="text-[11px] font-bold text-slate-400 capitalize">${item.replace('_', ' ')}</span>
            <span class="text-sm font-extrabold text-emerald-400 mb-2">$${price}</span>
            <div class="flex gap-1 w-full">
                <button class="flex-1 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[10px] font-bold" onclick="window.buyRaw('${item}', 1)">+1</button>
                <button class="flex-1 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[10px] font-bold" onclick="window.buyRaw('${item}', 10)">+10</button>
            </div>
        `;
        return card;
    };

    // Render Recommended
    if (recommendedItems.length > 0) {
        recommendedItems.forEach(data => container.appendChild(createShopCard(data)));
    }

    // Render "See More" section
    if (otherItems.length > 0) {
        const seeMoreContainer = document.createElement('div');
        seeMoreContainer.className = 'col-span-2 mt-2';
        seeMoreContainer.innerHTML = `
            <button id="toggle-shop-btn" class="w-full py-2 text-xs font-bold text-slate-500 uppercase tracking-widest hover:text-white transition-colors flex items-center justify-center gap-2">
                <span>See More Items</span>
                <span class="material-symbols-rounded text-sm transition-transform" id="shop-chevron">expand_more</span>
            </button>
            <div id="other-shop-items" class="grid grid-cols-2 gap-3 mt-3 hidden"></div>
        `;
        container.appendChild(seeMoreContainer);

        const otherContainer = seeMoreContainer.querySelector('#other-shop-items');
        otherItems.forEach(data => otherContainer.appendChild(createShopCard(data)));

        // Toggle Logic
        const btn = seeMoreContainer.querySelector('#toggle-shop-btn');
        const chevron = seeMoreContainer.querySelector('#shop-chevron');
        let expanded = false;

        btn.onclick = () => {
            expanded = !expanded;
            if (expanded) {
                otherContainer.classList.remove('hidden');
                btn.querySelector('span').textContent = 'Hide Other Items';
                chevron.classList.add('rotate-180');
            } else {
                otherContainer.classList.add('hidden');
                btn.querySelector('span').textContent = 'See More Items';
                chevron.classList.remove('rotate-180');
            }
        };
    }
}

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

    if (myPlayer.isAdmin) {
        document.getElementById('admin-tab-link').classList.remove('hidden');
        // Switch to admin tab immediately for admin
        document.querySelector('[data-tab="admin"]').click();
        // Hide player-only elements
        document.getElementById('dashboard-sidebar').classList.add('hidden');
        document.getElementById('inventory-section').classList.add('hidden');
        document.getElementById('vitals-section').classList.add('hidden');
        document.getElementById('status-container').classList.add('hidden');
        document.getElementById('header-money-container').classList.add('hidden');
        document.querySelectorAll('.tab-link[data-tab="dashboard"]').forEach(el => el.classList.add('hidden'));

        // Hide market listing and expand display for admin
        const marketListing = document.getElementById('market-listing-section');
        const marketDisplay = document.getElementById('market-display-section');
        if (marketListing) marketListing.classList.add('hidden');
        if (marketDisplay) {
            marketDisplay.classList.remove('lg:col-span-8', 'xl:col-span-9');
            marketDisplay.classList.add('lg:col-span-12', 'xl:col-span-12');
        }
    } else {
        updateBusinessUIData();
        renderShop();
    }

    if (roundEndTime) startTimer(roundEndTime);

    if (!gameStarted && !myPlayer.isAdmin) {
        showNotification("Waiting for admin to start round...", "info");
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
    hasAnalyticsUpdate = true;
    allPlayers = players;
    market = serverMarket;
    myPlayer = players[socket.id] || myPlayer;

    renderAll();
});

function renderAll() {
    if (!myPlayer) return;

    // Header & Global Stats
    document.getElementById('header-money').textContent = `$${myPlayer.money.toLocaleString()}`;
    document.getElementById('player-status-text').textContent = myPlayer.alive ? 'ALIVE' : 'DEAD';
    document.getElementById('player-status-badge').className = myPlayer.alive ? 'w-2 h-2 rounded-full bg-white animate-ping' : 'w-2 h-2 rounded-full bg-slate-400';

    const statusContainer = document.getElementById('status-container');
    if (statusContainer) {
        statusContainer.className = myPlayer.alive
            ? 'px-3 py-1.5 bg-emerald-500 rounded-full flex items-center gap-1.5 shadow-lg shadow-emerald-500/20'
            : 'px-3 py-1.5 bg-slate-700 rounded-full flex items-center gap-1.5 shadow-lg';
    }

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
    if (myPlayer.isAdmin) return;
    const vitals = ['health', 'hunger', 'thirst'];
    vitals.forEach(stat => {
        const val = myPlayer[stat];
        const gauge = document.getElementById(`${stat}-gauge`);
        const text = document.getElementById(`${stat}-val`);
        if (gauge && text) {
            // Dasharray is 176. Offset: 176 - (176 * val / 100)
            const offset = 176 - (176 * (val || 0) / 100);
            gauge.style.strokeDashoffset = offset;
            text.textContent = `${stat.charAt(0).toUpperCase() + stat.slice(1)} ${val || 0}%`;
        }
    });
}



window.buyRaw = (material, quantity) => {
    socket.emit('buyRaw', { material, quantity });
};

const BUSINESS_SWITCH_FEE = 100;

function updateBusinessUIData() {
    const businessName = myPlayer.businessType;
    if (!RECIPES[businessName]) return; // Safety check

    const recipe = RECIPES[businessName];
    document.getElementById('business-display-name').textContent = businessName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    document.getElementById('business-icon').textContent = recipe.icon;

    const info = document.getElementById('recipe-info');
    let html = `<div class="flex justify-between text-xs font-medium mb-2"><span class="text-slate-500">Requirements:</span><span class="text-slate-300">`;
    const reqs = Object.entries(recipe).filter(([k]) => k !== 'output' && k !== 'icon').map(([mat, qty]) => `${qty}x ${mat.replace('_', ' ')}`).join(', ');
    html += reqs + `</span></div>`;

    // Buy Materials Buttons
    html += `
        <div class="grid grid-cols-2 gap-2 mt-4">
            <button class="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-xs transition-all border border-transparent hover:border-white/5" onclick="window.buyMaterialsFor(1)">Buy 1x</button>
            <button class="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-xs transition-all border border-transparent hover:border-white/5" onclick="window.buyMaterialsFor(10)">Buy 10x</button>
        </div>
    `;

    // Change Business Button
    html += `
        <button onclick="window.openBusinessSwitchModal()" 
            class="w-full mt-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:border-primary text-slate-400 hover:text-white font-bold text-xs transition-all uppercase tracking-wider flex items-center justify-center gap-2 group">
            <span class="material-symbols-rounded text-base group-hover:rotate-180 transition-transform duration-500">sync_alt</span>
            Change Business
        </button>
    `;

    info.innerHTML = html;
}

window.openBusinessSwitchModal = () => {
    // Create modal elements
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 opacity-0 transition-opacity duration-300';

    const modal = document.createElement('div');
    modal.className = 'bg-card-dark border border-slate-700 rounded-2xl w-full max-w-2xl transform scale-95 transition-transform duration-300 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]';

    const availableBusinesses = Object.keys(RECIPES).filter(b => b !== myPlayer.businessType);

    modal.innerHTML = `
        <div class="p-6 border-b border-slate-700/50 flex justify-between items-center">
            <div>
                <h3 class="text-xl font-bold text-white">Switch Business</h3>
                <p class="text-slate-500 text-xs mt-1">Cost: <span class="${myPlayer.money >= BUSINESS_SWITCH_FEE ? 'text-emerald-400' : 'text-rose-400'} font-bold">$${BUSINESS_SWITCH_FEE}</span></p>
            </div>
            <button id="modal-close-btn" class="text-slate-500 hover:text-white transition-colors"><span class="material-symbols-rounded">close</span></button>
        </div>
        <div class="p-6 overflow-y-auto custom-scrollbar">
            <p class="text-amber-400/90 text-xs font-bold bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl mb-6 flex items-start gap-2">
                <span class="material-symbols-rounded text-lg">warning</span>
                <span>Warning: Switching business will cancel all unsold market listings and return items to your inventory. Production queues are cleared. This cannot be undone.</span>
            </p>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                ${availableBusinesses.map(b => {
        const recipe = RECIPES[b];
        const niceName = b.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        return `
                        <label class="relative cursor-pointer group">
                            <input type="radio" name="new_business" value="${b}" class="peer sr-only">
                            <div class="p-4 bg-slate-800/50 border-2 border-slate-700/50 rounded-xl hover:border-primary/50 peer-checked:border-primary peer-checked:bg-primary/10 transition-all h-full">
                                <div class="flex items-center gap-3 mb-2">
                                    <div class="w-10 h-10 rounded-lg bg-slate-700/50 flex items-center justify-center peer-checked:bg-primary/20 text-slate-400 peer-checked:text-primary transition-colors">
                                        <span class="material-symbols-rounded">${recipe.icon}</span>
                                    </div>
                                    <span class="font-bold text-slate-200 peer-checked:text-white">${niceName}</span>
                                </div>
                                <div class="text-[10px] text-slate-500">
                                    Produces: <span class="text-slate-300 font-bold capitalize">${recipe.output.replace('_', ' ')}</span>
                                </div>
                            </div>
                        </label>
                    `;
    }).join('')}
            </div>
        </div>
        <div class="p-4 bg-slate-900/50 flex gap-3 justify-end border-t border-slate-700/50">
            <button id="modal-cancel" class="px-5 py-2.5 rounded-xl text-slate-400 hover:text-white font-bold text-xs uppercase tracking-wider transition-colors">Cancel</button>
            <button id="modal-confirm-switch" class="px-5 py-2.5 rounded-xl bg-primary text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-blue-500/20 hover:bg-blue-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                Confirm Switch (-$${BUSINESS_SWITCH_FEE})
            </button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        modal.classList.remove('scale-95');
        modal.classList.add('scale-100');
    });

    // Logic
    const confirmBtn = document.getElementById('modal-confirm-switch');
    const radios = modal.querySelectorAll('input[name="new_business"]');

    // Disable if not enough money
    if (myPlayer.money < BUSINESS_SWITCH_FEE) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Insufficient Funds";
    }

    let selectedType = null;
    radios.forEach(r => {
        r.addEventListener('change', (e) => {
            selectedType = e.target.value;
            // No need to enable/disable here based on selection, button is enabled if money >= fee
        });
    });

    const close = () => {
        overlay.classList.add('opacity-0');
        modal.classList.remove('scale-100');
        modal.classList.add('scale-95');
        setTimeout(() => overlay.remove(), 300);
    };

    document.getElementById('modal-cancel').onclick = close;
    document.getElementById('modal-close-btn').onclick = close;

    confirmBtn.onclick = () => {
        if (!selectedType) {
            showNotification('Please select a business type.', 'error');
            return;
        }
        if (myPlayer.money < BUSINESS_SWITCH_FEE) return; // double check

        socket.emit('switchBusiness', { newBusinessType: selectedType });
        close();
    };
};

socket.on('businessSwitched', ({ businessType }) => {
    myPlayer.businessType = businessType;
    updateBusinessUIData();
    renderShop(); // Update shop logic if needed (though shop is generic currently)
});

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
        if (qty > 0) {
            const card = createItemCard(item, qty, 'blue');
            const btn = document.createElement('button');
            btn.className = 'text-[9px] font-black uppercase tracking-widest text-blue-400 bg-white/5 px-2 py-1 rounded hover:bg-blue-500 hover:text-white transition-all w-full mt-1';
            btn.textContent = 'Consume';
            btn.onclick = (e) => {
                e.stopPropagation();
                socket.emit('consume', { item });
            };
            card.appendChild(btn);
            finishedList.appendChild(card);
        }
    });

    purchasedList.innerHTML = '';
    Object.entries(myPlayer.inventory.purchasedGoods).forEach(([item, qty]) => {
        if (qty > 0) {
            const card = createItemCard(item, qty, 'pink');
            const btn = document.createElement('button');
            btn.className = 'text-[9px] font-black uppercase tracking-widest text-pink-400 bg-white/5 px-2 py-1 rounded hover:bg-pink-500 hover:text-white transition-all w-full mt-1';
            btn.textContent = 'Consume';
            btn.onclick = (e) => {
                e.stopPropagation();
                socket.emit('consume', { item });
            };
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
        <span class="material-symbols-rounded text-3xl text-${color}-300 group-hover:scale-110 transition-transform">${ITEM_ICONS[item] || 'inventory_2'}</span>
        <span class="text-[10px] font-bold text-${color}-300 capitalize text-center leading-tight">${item.replace('_', ' ')}</span>
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
        const icon = ITEM_ICONS[listing.item] || 'inventory';

        const card = document.createElement('div');
        card.className = 'bg-card-dark border border-slate-800 rounded-2xl p-5 hover:border-primary/50 transition-all group relative overflow-hidden flex flex-col justify-between h-full';

        // Ownership Check
        const isMyListing = listing.sellerId === socket.id;

        card.innerHTML = `
            <div>
                <div class="flex items-start justify-between mb-4">
                    <div class="flex items-center space-x-3">
                        <div class="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center border border-blue-500/20">
                            <span class="material-symbols-rounded text-blue-500 text-2xl">${icon}</span>
                        </div>
                        <div>
                            <h3 class="font-bold capitalize text-slate-200">${listing.item.replace('_', ' ')}</h3>
                            <span class="text-xs text-slate-500">Seller: <span class="${isMyListing ? 'text-emerald-400 font-bold' : 'text-blue-400'}">@${listing.sellerName}</span></span>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="block text-[10px] text-slate-500 uppercase font-bold tracking-tight">Price Each</span>
                        <span class="text-lg font-bold text-emerald-400">$${listing.price}</span>
                    </div>
                </div>
                <div class="flex items-center justify-between mb-5 bg-slate-900/50 rounded-xl p-3 border border-slate-800">
                    <div class="text-center flex-1 border-r border-slate-800">
                        <span class="block text-[10px] text-slate-500 uppercase font-bold">Qty</span>
                        <span class="text-sm font-bold text-white">${listing.quantity}</span>
                    </div>
                    <div class="text-center flex-1">
                        <span class="block text-[10px] text-slate-500 uppercase font-bold">Total</span>
                        <span class="text-sm font-bold text-white">$${listing.quantity * listing.price}</span>
                    </div>
                </div>
            </div>
            
            ${!isMyListing ? `
                <div class="flex gap-2 mt-auto">
                    <button class="flex-1 bg-slate-800 hover:bg-primary hover:text-white text-slate-300 font-bold py-3 rounded-xl transition-all text-xs uppercase tracking-wider" onclick="window.buyMarket('${listing.id}', 1)">Buy 1</button>
                    <button class="flex-1 bg-slate-800 hover:bg-primary hover:text-white text-slate-300 font-bold py-3 rounded-xl transition-all text-xs uppercase tracking-wider" onclick="window.buyMarket('${listing.id}', ${listing.quantity})">Buy All</button>
                </div>
            ` : `
                <div class="w-full mt-auto">
                    <button onclick="window.cancelListing('${listing.id}')" 
                        class="w-full py-3 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 font-bold text-xs uppercase tracking-wider transition-all border border-transparent hover:border-rose-500/30 flex items-center justify-center gap-2">
                        <span class="material-symbols-rounded text-base">delete_forever</span>
                        <span>Take Back Items</span>
                    </button>
                </div>
            `}
        `;
        container.appendChild(card);
    });
}

// --- Modal System ---
function showConfirmationModal(title, message, onConfirm) {
    // Create modal elements
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 opacity-0 transition-opacity duration-300';

    const modal = document.createElement('div');
    modal.className = 'bg-card-dark border border-slate-700 rounded-2xl w-full max-w-md transform scale-95 transition-transform duration-300 shadow-2xl overflow-hidden';

    modal.innerHTML = `
        <div class="p-6 border-b border-slate-700/50">
            <h3 class="text-xl font-bold text-white">${title}</h3>
        </div>
        <div class="p-6">
            <p class="text-slate-300 text-sm leading-relaxed">${message}</p>
        </div>
        <div class="p-4 bg-slate-900/50 flex gap-3 justify-end">
            <button id="modal-cancel" class="px-5 py-2.5 rounded-xl text-slate-400 hover:text-white font-bold text-xs uppercase tracking-wider transition-colors">Cancel</button>
            <button id="modal-confirm" class="px-5 py-2.5 rounded-xl bg-primary text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-blue-500/20 hover:bg-blue-600 transition-all">Confirm</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        modal.classList.remove('scale-95');
        modal.classList.add('scale-100');
    });

    // Handlers
    const close = () => {
        overlay.classList.add('opacity-0');
        modal.classList.remove('scale-100');
        modal.classList.add('scale-95');
        setTimeout(() => overlay.remove(), 300);
    };

    document.getElementById('modal-cancel').onclick = close;
    document.getElementById('modal-confirm').onclick = () => {
        onConfirm();
        close();
    };
}

window.cancelListing = (listingId, itemName, quantity) => {
    const formattedName = itemName.replace('_', ' ').toUpperCase();
    const msg = `Are you sure you want to remove your listing for <b>${quantity}x ${formattedName}</b>?<br><br>These items will be returned to your inventory immediately.`;

    showConfirmationModal('Retract Listing', msg, () => {
        socket.emit('cancelListing', { listingId });
    });
};

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
    display.classList.remove('hidden');

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
        if (p.isAdmin) return; // Don't show other admins in the list

        const card = document.createElement('div');
        card.className = `p-3 hover:bg-slate-800/40 transition-colors group border-l-2 ${p.alive ? 'border-primary' : 'border-danger-red'} rounded-r-xl bg-slate-900/40 border-slate-700/50`;
        card.innerHTML = `
            <div class="flex items-center justify-between mb-3">
                <div class="flex items-center space-x-3">
                    <div class="relative">
                        <div class="w-10 h-10 rounded-lg bg-slate-800 text-primary shadow-inner flex items-center justify-center font-bold text-xs border border-slate-700">
                            ${p.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div class="absolute -bottom-1 -right-1 w-3 h-3 ${p.alive ? 'bg-emerald-500' : 'bg-slate-500'} border-2 border-slate-900 rounded-full shadow-lg"></div>
                    </div>
                    <div>
                        <div class="font-bold text-sm text-slate-200">${p.name}</div>
                        <div class="text-[9px] text-slate-500 font-mono">ID: ${p.id.substring(0, 6)}</div>
                    </div>
                </div>
                <div class="flex flex-col items-end">
                    <span class="font-mono font-bold text-emerald-400 text-xs bg-emerald-950/30 px-2 py-1 rounded border border-emerald-900/50">$${p.money.toLocaleString()}</span>
                </div>
            </div>
            
            <div class="space-y-2 mb-3">
                <div class="flex items-center space-x-2">
                    <span class="text-[8px] text-slate-500 w-4 font-bold">VIT</span>
                    <div class="w-full h-1 bg-slate-800 rounded-full overflow-hidden flex gap-0.5">
                        <div class="h-full bg-emerald-500" style="width: ${p.health}%"></div>
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    <span class="text-[8px] text-slate-500 w-4 font-bold">HGR</span>
                    <div class="w-full h-1 bg-slate-800 rounded-full overflow-hidden flex gap-0.5">
                        <div class="h-full bg-amber-500" style="width: ${p.hunger}%"></div>
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    <span class="text-[8px] text-slate-500 w-4 font-bold">THR</span>
                    <div class="w-full h-1 bg-slate-800 rounded-full overflow-hidden flex gap-0.5">
                        <div class="h-full bg-sky-500" style="width: ${p.thirst}%"></div>
                    </div>
                </div>
            </div>

            <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/50">
                <div class="flex items-center gap-1">
                    <input type="number" id="donate-amt-${p.id}" placeholder="$" class="w-14 bg-black border border-slate-700 rounded text-[10px] py-1 text-white px-2 focus:border-primary outline-none">
                    <button class="p-1.5 text-slate-500 hover:text-emerald-400 hover:bg-emerald-400/10 rounded transition-colors" onclick="window.adminDonate('${p.id}')">
                        <span class="material-symbols-outlined text-sm">volunteer_activism</span>
                    </button>
                </div>
                ${!p.alive ? `
                    <button class="px-2 py-1 bg-primary text-white text-[9px] font-bold rounded hover:bg-blue-600 transition-all uppercase" onclick="window.adminRevive('${p.id}')">
                        Revive
                    </button>
                ` : ''}
            </div>
        `;
        playerList.appendChild(card);
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
// --- Admin Analytics State ---
const chartData = {
    water: { prices: [], demand: [] },
    hotdog: { prices: [], demand: [] },
    medicine: { prices: [], demand: [] },
    global: { supply: [] }
};
const MAX_HISTORY = 20;
const accumulatedTradeCounts = { water: 0, hotdog: 0, medicine: 0 };

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

    // Track for charts
    if (Object.prototype.hasOwnProperty.call(accumulatedTradeCounts, trade.item)) {
        accumulatedTradeCounts[trade.item] += trade.quantity;
        hasAnalyticsUpdate = true;
    }
});

// Update chart history every 2 seconds
setInterval(() => {
    if (!myPlayer?.isAdmin) return; // Only process for admin
    if (!hasAnalyticsUpdate) return;


    // Calculate Global Supply (Market + Players)
    let totalSupply = 0;
    market.forEach(l => totalSupply += l.quantity);
    Object.values(allPlayers).forEach(p => {
        if (p.inventory) {
            ['finishedGoods', 'rawMaterials', 'purchasedGoods'].forEach(cat => {
                if (p.inventory[cat]) {
                    Object.values(p.inventory[cat]).forEach(qty => totalSupply += qty);
                }
            });
        }
    });

    // Add to Global History
    addToHistory(chartData.global.supply, totalSupply);
    updateChartPath('global-supply-line', chartData.global.supply, false);
    const supplyDisplay = document.getElementById('global-supply-count');
    if (supplyDisplay) supplyDisplay.textContent = `Total Units: ${totalSupply}`;

    // Calculate current average listing prices
    const itemPrices = { water: [], hotdog: [], medicine: [] };
    market.forEach(l => {
        if (itemPrices[l.item]) itemPrices[l.item].push(l.price);
    });

    // Process specific items
    ['water', 'hotdog', 'medicine'].forEach(item => {
        // Price: Avg of current listings, or 0 if none
        const prices = itemPrices[item];
        const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
        addToHistory(chartData[item].prices, avgPrice);

        // Demand (Trades in last interval)
        const demand = accumulatedTradeCounts[item];
        addToHistory(chartData[item].demand, demand);
        accumulatedTradeCounts[item] = 0; // Reset counter

        // Render
        updateChartPath(`${item}-price-line`, chartData[item].prices, true);
        updateChartPath(`${item}-demand-line`, chartData[item].demand, false);

        // Update Price Display
        const priceDisplay = document.getElementById(`${item}-price-display`);
        if (priceDisplay) priceDisplay.textContent = `$${avgPrice.toFixed(2)}`;
    });

    hasAnalyticsUpdate = false;

}, 2000);

function addToHistory(arr, val) {
    arr.push(val);
    if (arr.length > MAX_HISTORY) arr.shift();
}

function updateChartPath(elementId, data, isPrice) {
    const el = document.getElementById(elementId);
    if (!el) return;

    // Use dynamic scaling
    let maxVal = Math.max(...data, 1) * 1.2;
    if (isPrice && maxVal < 10) maxVal = 10;
    if (!isPrice && maxVal < 5) maxVal = 5;

    const stepX = 100 / (MAX_HISTORY - 1);

    const points = data.map((val, i) => {
        const x = i * stepX;
        // Map val 0->maxVal to 45->5 (leaving 5px padding top/bottom)
        const y = 45 - ((val / maxVal) * 40);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    if (points.length < 2) {
        el.setAttribute('d', `M0,45 L100,45`);
        return;
    }

    let d = `M${points[0]}`;
    for (let i = 1; i < points.length; i++) {
        d += ` L${points[i]}`;
    }
    el.setAttribute('d', d);
}
