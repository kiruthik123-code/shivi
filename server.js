import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());

// Serve static files from the 'dist' directory
app.use(express.static(path.join(__dirname, 'dist')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Game Constants
const RECIPES = {
    water_vendor: { plastic: 1, water_raw: 1, output: 'water' },
    hotdog_vendor: { bread: 1, meat: 1, output: 'hotdog' },
    chicken_rice_vendor: { rice: 2, meat: 1, water_raw: 1, output: 'chicken_rice' },
    juice_vendor: { fruit: 2, water_raw: 1, output: 'juice' }
};

const SYSTEM_SHOP = {
    rice: 2,
    meat: 3,
    water_raw: 1,
    plastic: 1,
    bread: 2,
    fruit: 3
    // chemical removed
};

const BUSINESS_SWITCH_FEE = 100;

const CONSUMPTION_EFFECTS = {
    water: { thirst: 40 },
    hotdog: { hunger: 40 },
    chicken_rice: { hunger: 60 },
    juice: { thirst: 30, health: 10 }
};

const DECAY_INTERVAL = 10000; // 10 seconds
const ROUND_DURATION = 15 * 60 * 1000; // 15 minutes

// Game State
let players = {};
let market = [];
let tradeLogs = [];
let gameStarted = false;
let roundEndTime = null;
let roundTimer = null;
let decayTimer = null;

function resetGameState() {
    Object.values(players).forEach(player => {
        player.money = 50;
        player.health = 100;
        player.hunger = 100;
        player.thirst = 100;
        player.alive = true;
        player.deathTime = null;
        player.inventory = {
            rawMaterials: { rice: 0, meat: 0, water_raw: 0, plastic: 0, bread: 0, chemical: 0 },
            finishedGoods: { water: 0, hotdog: 0, chicken_rice: 0, medicine: 0 },
            purchasedGoods: { water: 0, hotdog: 0, chicken_rice: 0, medicine: 0 }
        };
    });
    market = [];
    tradeLogs = [];
    gameStarted = false;
    roundEndTime = null;
    if (roundTimer) clearTimeout(roundTimer);
    if (decayTimer) clearInterval(decayTimer);
    io.emit('stateUpdate', { players, market });
}

function startRound() {
    resetGameState();
    gameStarted = true;
    roundEndTime = Date.now() + ROUND_DURATION;

    io.emit('roundStarted', { roundEndTime });

    decayTimer = setInterval(() => {
        Object.values(players).forEach(player => {
            if (!player.alive || player.isAdmin) return;

            player.hunger = Math.max(0, player.hunger - 2);
            player.thirst = Math.max(0, player.thirst - 3);

            if (player.hunger === 0 || player.thirst === 0) {
                player.health = Math.max(0, player.health - 5);
            }

            if (player.health <= 0) {
                player.alive = false;
                player.deathTime = Date.now();
                io.emit('playerDied', { id: player.id, name: player.name });
            }
        });

        checkWinCondition();
        io.emit('stateUpdate', { players, market });
    }, DECAY_INTERVAL);

    roundTimer = setTimeout(() => {
        endRound();
    }, ROUND_DURATION);
}

function endRound() {
    gameStarted = false;
    if (decayTimer) clearInterval(decayTimer);
    if (roundTimer) clearTimeout(roundTimer);

    // Only active players in the current round who are alive
    const leaderboard = Object.values(players)
        .filter(p => !p.isAdmin && p.alive)
        .sort((a, b) => b.money - a.money);

    io.emit('roundEnded', { leaderboard });
}

function checkWinCondition() {
    const alivePlayers = Object.values(players).filter(p => p.alive);
    if (alivePlayers.length === 1 && Object.keys(players).length > 1) {
        endRound();
    }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join', ({ name, businessType }) => {
        const isAdmin = name.toLowerCase().includes('admin');

        // If a new admin joins, they might need to trigger a fresh round
        // Requirement: "When a new admin joins -> they must start a brand new round."
        if (isAdmin) {
            // Check if there's already an active admin? The req says "No round persistence between admins."
            // This suggests we might need to reset if an admin joins?
            // "If admin disconnects... the round must automatically end."
            // If they just joined, we don't necessarily reset unless they are replacing one.
        }

        players[socket.id] = {
            id: socket.id,
            name,
            isAdmin,
            money: isAdmin ? 0 : 50,
            health: isAdmin ? 100 : 100, // Still 100 but decay won't affect
            hunger: isAdmin ? 100 : 100,
            thirst: isAdmin ? 100 : 100,
            businessType: isAdmin ? 'spectator' : businessType,
            alive: !isAdmin && !gameStarted, // Only alive if game hasn't started
            joinTime: Date.now(),
            inventory: isAdmin ? null : {
                rawMaterials: { rice: 0, meat: 0, water_raw: 0, plastic: 0, bread: 0, chemical: 0 },
                finishedGoods: { water: 0, hotdog: 0, chicken_rice: 0, medicine: 0 },
                purchasedGoods: { water: 0, hotdog: 0, chicken_rice: 0, medicine: 0 }
            }
        };

        socket.emit('joined', { player: players[socket.id], gameStarted, roundEndTime });

        if (gameStarted && !isAdmin) {
            socket.emit('notification', { message: 'Round in progress. You will join the next one.', type: 'info' });
        } else if (!gameStarted && !isAdmin) {
            socket.emit('notification', { message: 'Waiting for admin to start round...' });
        }

        io.emit('stateUpdate', { players, market });
    });

    socket.on('buyRaw', ({ material, quantity }) => {
        const player = players[socket.id];
        if (!player || !player.alive || player.isAdmin) return;

        const cost = SYSTEM_SHOP[material] * quantity;
        if (player.money >= cost) {
            player.money -= cost;
            player.inventory.rawMaterials[material] += quantity;
            socket.emit('notification', { message: `Bought ${quantity} ${material} for $${cost}` });
            io.emit('stateUpdate', { players, market });
        } else {
            socket.emit('notification', { message: 'Insufficient money!', type: 'error' });
        }
    });

    socket.on('produce', () => {
        const player = players[socket.id];
        if (!player || !player.alive || player.isAdmin) return;

        const recipe = RECIPES[player.businessType];
        const workshopFee = 1;

        if (player.money < workshopFee) {
            socket.emit('notification', { message: 'Insufficient money for workshop fee!', type: 'error' });
            return;
        }

        // Check materials
        for (const [material, amount] of Object.entries(recipe)) {
            if (material === 'output') continue;
            if (player.inventory.rawMaterials[material] < amount) {
                socket.emit('notification', { message: `Insufficient ${material}!`, type: 'error' });
                return;
            }
        }

        // Subtract materials and fee
        for (const [material, amount] of Object.entries(recipe)) {
            if (material === 'output') continue;
            player.inventory.rawMaterials[material] -= amount;
        }
        player.money -= workshopFee;
        player.inventory.finishedGoods[recipe.output] += 1;

        socket.emit('notification', { message: `Produced 1 ${recipe.output}` });
        io.emit('stateUpdate', { players, market });
    });

    socket.on('switchBusiness', ({ newBusinessType }) => {
        const player = players[socket.id];
        if (!player || !player.alive || player.isAdmin) return;
        if (!RECIPES[newBusinessType]) return;
        if (player.businessType === newBusinessType) {
            socket.emit('notification', { message: 'You already own this business!', type: 'error' });
            return;
        }

        if (player.money < BUSINESS_SWITCH_FEE) {
            socket.emit('notification', { message: `Insufficient funds! Need $${BUSINESS_SWITCH_FEE} to switch.`, type: 'error' });
            return;
        }

        // Deduct Fee
        player.money -= BUSINESS_SWITCH_FEE;

        // Cancel Unsold Market Listings
        // Note: Returning items to inventory before clearing listing
        market.forEach((listing, index) => {
            if (listing.sellerId === socket.id) {
                // Return items to inventory
                player.inventory.finishedGoods[listing.item] += listing.quantity;
            }
        });
        // Remove listings from global market array
        market = market.filter(l => l.sellerId !== socket.id);

        // Update Business
        const oldBusiness = player.businessType;
        player.businessType = newBusinessType;

        socket.emit('notification', { message: `Business switched from ${oldBusiness.replace('_', ' ')} to ${newBusinessType.replace('_', ' ')}!`, type: 'success' });
        // Send updated player state immediately
        socket.emit('businessSwitched', { businessType: newBusinessType });
        io.emit('stateUpdate', { players, market });
    });

    socket.on('listMarket', ({ item, quantity, price }) => {
        const player = players[socket.id];
        if (!player || !player.alive || player.isAdmin) return;

        if (player.inventory.finishedGoods[item] >= quantity) {
            player.inventory.finishedGoods[item] -= quantity;
            market.push({
                id: Math.random().toString(36).substr(2, 9),
                sellerId: socket.id,
                sellerName: player.name,
                item,
                quantity,
                price
            });
            socket.emit('notification', { message: `Listed ${quantity} ${item} on market` });
            io.emit('stateUpdate', { players, market });
        } else {
            socket.emit('notification', { message: 'Insufficient finished goods!', type: 'error' });
        }
    });

    socket.on('cancelListing', ({ listingId }) => {
        const player = players[socket.id];
        if (!player || !player.alive || player.isAdmin) return;

        const listingIndex = market.findIndex(l => l.id === listingId);
        if (listingIndex === -1) {
            socket.emit('notification', { message: 'Listing not found!', type: 'error' });
            return;
        }

        const listing = market[listingIndex];
        if (listing.sellerId !== socket.id) {
            socket.emit('notification', { message: 'Not your listing!', type: 'error' });
            return;
        }

        // Return items to inventory
        player.inventory.finishedGoods[listing.item] += listing.quantity;

        // Remove listing
        market.splice(listingIndex, 1);

        socket.emit('notification', { message: 'Listing cancelled. Items returned.', type: 'info' });
        io.emit('stateUpdate', { players, market });
    });

    socket.on('buyMarket', ({ listingId, quantity }) => {
        const buyer = players[socket.id];
        if (!buyer || !buyer.alive || buyer.isAdmin) return;

        const listingIndex = market.findIndex(l => l.id === listingId);
        if (listingIndex === -1) return;

        const listing = market[listingIndex];
        if (listing.sellerId === socket.id) {
            socket.emit('notification', { message: 'You cannot buy your own items!', type: 'error' });
            return;
        }

        const cost = listing.price * quantity;
        if (buyer.money >= cost && listing.quantity >= quantity) {
            buyer.money -= cost;
            buyer.inventory.purchasedGoods[listing.item] += quantity;

            const seller = players[listing.sellerId];
            if (seller) {
                seller.money += cost;
                io.to(listing.sellerId).emit('notification', { message: `${buyer.name} bought ${quantity} unit of your ${listing.item}` });
            }

            listing.quantity -= quantity;
            if (listing.quantity === 0) {
                market.splice(listingIndex, 1);
            }

            const tradeData = { buyer: buyer.name, seller: seller ? seller.name : 'Unknown', item: listing.item, quantity, price: listing.price, time: Date.now() };
            tradeLogs.push(tradeData);
            io.emit('tradeOccurred', tradeData);
            socket.emit('notification', { message: `Bought ${quantity} ${listing.item}` });
            io.emit('stateUpdate', { players, market });
        } else {
            socket.emit('notification', { message: 'Buy failed: Insufficient funds or stock.', type: 'error' });
        }
    });

    socket.on('consume', ({ item }) => {
        const player = players[socket.id];
        if (!player || !player.alive || player.isAdmin) return;

        let consumed = false;
        if (player.inventory.purchasedGoods[item] > 0) {
            player.inventory.purchasedGoods[item] -= 1;
            consumed = true;
        } else if (player.inventory.finishedGoods[item] > 0) {
            player.inventory.finishedGoods[item] -= 1;
            consumed = true;
        }

        if (consumed) {
            const effect = CONSUMPTION_EFFECTS[item];
            if (effect) {
                for (const [stat, value] of Object.entries(effect)) {
                    player[stat] = Math.min(100, player[stat] + value);
                }
                const msg = `You consumed ${item.replace('_', ' ')}!`;
                socket.emit('notification', { message: msg });
            }
            io.emit('stateUpdate', { players, market });
        } else {
            socket.emit('notification', { message: `No ${item} to consume!`, type: 'error' });
        }
    });

    socket.on('chat', (message) => {
        const player = players[socket.id];
        if (player) {
            io.emit('chat', { name: player.name, message });
        }
    });

    // Admin Features
    socket.on('adminStartRound', () => {
        const player = players[socket.id];
        if (player && player.isAdmin && !gameStarted) {
            startRound();
            io.emit('notification', { message: 'New round started' });
        }
    });

    socket.on('adminEndRound', () => {
        const player = players[socket.id];
        if (player && player.isAdmin && gameStarted) {
            endRound();
            io.emit('notification', { message: 'Admin ended the round' });
        }
    });

    socket.on('adminRevive', ({ playerId }) => {
        const player = players[playerId];
        if (player) {
            player.alive = true;
            player.health = 50;
            player.hunger = 50;
            player.thirst = 50;
            player.deathTime = null;
            io.emit('stateUpdate', { players, market });
            socket.emit('notification', { message: `Revived ${player.name}` });
        }
    });

    socket.on('adminDonate', ({ playerId, amount }) => {
        const player = players[playerId];
        if (player) {
            player.money += amount;
            io.emit('stateUpdate', { players, market });
            socket.emit('notification', { message: `Donated $${amount} to ${player.name}` });
            io.to(playerId).emit('notification', { message: `Admin donated $${amount} to you!` });
        }
    });

    socket.on('disconnect', () => {
        const player = players[socket.id];
        console.log('User disconnected:', socket.id);

        if (player && player.isAdmin) {
            console.log('Admin left, ending round');
            if (gameStarted) {
                endRound();
                io.emit('notification', { message: 'Admin left -> round ended', type: 'error' });
            }
        }

        // Remove player if they disconnect
        delete players[socket.id];

        // Clean up market listings for this player
        market = market.filter(l => l.sellerId !== socket.id);

        io.emit('stateUpdate', { players, market });
    });
});

// Wildcard route to serve index.html for SPA routing
// In Express 5, use a Regex literal for a catch-all route to avoid path-to-regexp errors
app.get(/^(?!\/socket\.io).+/, (req, res) => {
    res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

export default server;
