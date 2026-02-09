import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());
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
    medicine_vendor: { chemical: 2, output: 'medicine' }
};

const SYSTEM_SHOP = {
    rice: 2,
    meat: 3,
    water_raw: 1,
    plastic: 1,
    bread: 2,
    chemical: 4
};

const CONSUMPTION_EFFECTS = {
    water: { thirst: 40 },
    hotdog: { hunger: 40 },
    chicken_rice: { hunger: 60 },
    medicine: { health: 30 }
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
    players = {};
    market = [];
    tradeLogs = [];
    gameStarted = false;
    roundEndTime = null;
    if (roundTimer) clearTimeout(roundTimer);
    if (decayTimer) clearInterval(decayTimer);
}

function startRound() {
    gameStarted = true;
    roundEndTime = Date.now() + ROUND_DURATION;

    io.emit('roundStarted', { roundEndTime });

    decayTimer = setInterval(() => {
        Object.values(players).forEach(player => {
            if (!player.alive) return;

            player.hunger = Math.max(0, player.hunger - 5);
            player.thirst = Math.max(0, player.thirst - 7);

            if (player.hunger === 0 || player.thirst === 0) {
                player.health = Math.max(0, player.health - 10);
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

    const leaderboard = Object.values(players).sort((a, b) => {
        if (b.money !== a.money) return b.money - a.money;
        return (b.deathTime || Date.now()) - (a.deathTime || Date.now());
    });

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
        players[socket.id] = {
            id: socket.id,
            name,
            money: 50,
            health: 100,
            hunger: 100,
            thirst: 100,
            businessType,
            alive: true,
            joinTime: Date.now(),
            inventory: {
                rawMaterials: { rice: 0, meat: 0, water_raw: 0, plastic: 0, bread: 0, chemical: 0 },
                finishedGoods: { water: 0, hotdog: 0, chicken_rice: 0, medicine: 0 },
                purchasedGoods: { water: 0, hotdog: 0, chicken_rice: 0, medicine: 0 }
            }
        };
        socket.emit('joined', { player: players[socket.id], gameStarted, roundEndTime });
        io.emit('stateUpdate', { players, market });
    });

    socket.on('buyRaw', ({ material, quantity }) => {
        const player = players[socket.id];
        if (!player || !player.alive) return;

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
        if (!player || !player.alive) return;

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

    socket.on('listMarket', ({ item, quantity, price }) => {
        const player = players[socket.id];
        if (!player || !player.alive) return;

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

    socket.on('buyMarket', ({ listingId, quantity }) => {
        const buyer = players[socket.id];
        if (!buyer || !buyer.alive) return;

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

            tradeLogs.push({ buyer: buyer.name, seller: seller ? seller.name : 'Unknown', item: listing.item, quantity, price: listing.price, time: Date.now() });
            socket.emit('notification', { message: `Bought ${quantity} ${listing.item}` });
            io.emit('stateUpdate', { players, market });
        } else {
            socket.emit('notification', { message: 'Buy failed: Insufficient funds or stock.', type: 'error' });
        }
    });

    socket.on('consume', ({ item }) => {
        const player = players[socket.id];
        if (!player || !player.alive) return;

        if (player.inventory.purchasedGoods[item] > 0) {
            player.inventory.purchasedGoods[item] -= 1;
            const effect = CONSUMPTION_EFFECTS[item];
            for (const [stat, value] of Object.entries(effect)) {
                player[stat] = Math.min(100, player[stat] + value);
            }
            socket.emit('notification', { message: `Consumed ${item}` });
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
        if (!gameStarted) startRound();
    });

    socket.on('adminEndRound', () => {
        if (gameStarted) endRound();
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
        console.log('User disconnected:', socket.id);
        // In a real game, we might keep the player for a while
        // but for MVP, let's keep them in the players object until round ends
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
