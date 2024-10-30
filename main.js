const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const settings = require("./settings.json");

let Queue;
let placeIdQueue;

import('queue').then(module => {
    Queue = module.default;
    placeIdQueue = new Queue({ concurrency: 1 });
    console.log("Queue initialized");
    client.login(bottoken);
}).catch(err => {
    console.error("Error importing queue:", err);
});

const client = new Client();
const channelId = settings.channelId;
const roblosecurity = settings.robloxcookie;
const bottoken = settings.bottoken;

let trackedUsers = require('./ids.json').tracked_users;
let lastOnlineCheck = {};
let lastPlayingCheck = {};
let lastGameState = {};
const tenMinutes = 10 * 60 * 1000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchServers(placeid, cursor = '', attempts = 0, sleepsecs) {
    const url = `https://games.roblox.com/v1/games/${placeid}/servers/Public?limit=100&cursor=${cursor}`;
    let data;
    await sleep(sleepsecs);
    await fetch(url)
        .then(re => re.json())
        .then(json => { data = json });

    if (data.errors) {
        return fetchServers(placeid, cursor, attempts, sleepsecs + (3 * 1000));
    }

    if (!data || attempts >= 60) {
        return null;
    }

    return { servers: data.data, nextCursor: data.nextPageCursor };
}

async function searchForPlayer(players, imgUrl, placeid, username) {
    for (let i = 0; i < players.length; i += 100) {
        const batch = players.slice(i, i + 100);

        const response = await fetch('https://thumbnails.roblox.com/v1/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch)
        });
        const data = await response.json();

        for (const item of data.data) {
            if (item.imageUrl === imgUrl) {
                return `Successfully found ${username}!\n\`\`\`js\nRoblox.GameLauncher.joinGameInstance(${placeid}, '${item.requestId}')\n\`\`\``;
            }
        }
    }
    return null;
}

async function find(imgUrl, placeid, username) {
    let allPlayers = [];
    let cursor = '';
    let foundPlayer = null;

    while (!foundPlayer) {
        const result = await fetchServers(placeid, '', 0, 0);
        if (!result || !result.servers) break;

        for (const server of result.servers) {
            allPlayers.push(...server.playerTokens.map(token => ({
                token,
                type: 'AvatarHeadshot',
                size: '150x150',
                requestId: server.id
            })));
        }
        cursor = result.nextCursor;

        foundPlayer = await searchForPlayer(allPlayers, imgUrl, placeid, username);
        if (foundPlayer) return foundPlayer;

        if (!cursor) break;
    }
    return null;
}


async function getUniverseId(placeId) {
    const response = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
    const data = await response.json();
    return data.universeId;
}


async function getPlayerCount(universeId) {
    const response = await fetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
    const data = await response.json();
    return data.data[0].playing;
}

async function getLatestBadges(userId, badgescount) {
    const datas = await fetch(`https://badges.roproxy.com/v1/users/${userId}/badges?limit=${badgescount}&sortOrder=Desc`);
    const js = await datas.json();
    let placeids = [];

    for (const item of js.data) {
        placeids.push(item.awarder.id);
    }

    return placeids;
}

async function getFavoriteGames(userId, gamecount) {
    const data = await fetch(`https://www.roblox.com/users/favorites/list-json?assetTypeId=9&itemsPerPage=${gamecount}&userId=${userId}&sortOrder=Desc`);
    const js = await data.json();
    let placeids = [];

    for (const item of js.Data.Items) {
        placeids.push(item.Item.AssetId);
    }

    return placeids;
}

async function checkUserOnline(robloxUserId) {
    try {
        const res = await fetch('https://presence.roproxy.com/v1/presence/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `.ROBLOSECURITY=${roblosecurity}`
            },
            body: JSON.stringify({ userIds: [robloxUserId] })
        });

        if (!res.ok) return { isOnline: false, isPlayingGame: false };
        const data = await res.json();
        const userPresence = data.userPresences[0];
        const isOnline = userPresence.userPresenceType !== 0;
        const isPlayingGame = userPresence.userPresenceType === 2;
        return { isOnline, isPlayingGame };
    } catch (error) {
        console.error('Error checking user status:', error);
    }
    return { isOnline: false, isPlayingGame: false };
}

async function checkTrackedUsers() {
    console.log('Starting user tracking check...');
    const currentTime = Date.now();
    for (const user of trackedUsers) {
        const { isOnline, isPlayingGame } = await checkUserOnline(user.id);
        
        if (isOnline) {
            if (!lastOnlineCheck[user.id] || currentTime - lastOnlineCheck[user.id] > tenMinutes) {
                const robloxProfileLink = `https://www.roblox.com/users/${user.id}/profile`;
                const message = `User (${user.id}), ${user.username} is online! ${robloxProfileLink}`;
                client.channels.fetch(channelId)
                    .then(channel => channel.send(message));
                lastOnlineCheck[user.id] = currentTime;
            }
            
            if (isPlayingGame) {
                if (!lastPlayingCheck[user.id] || currentTime - lastPlayingCheck[user.id] > tenMinutes) {
                    const robloxProfileLink = `https://www.roblox.com/users/${user.id}/profile`;
                    const message = `${user.username} is playing a game! ${robloxProfileLink}`;
                    client.channels.fetch(channelId)
                        .then(channel => channel.send(message));
                    await trackRobloxUser(client, user.id);
                    lastPlayingCheck[user.id] = currentTime;
                    lastGameState[user.id] = true;
                }
            } else if (lastGameState[user.id]) {
                
                const robloxProfileLink = `https://www.roblox.com/users/${user.id}/profile`;
                const message = `${user.username} is no longer playing a game, but still online. ${robloxProfileLink}`;
                client.channels.fetch(channelId)
                    .then(channel => channel.send(message));
                lastGameState[user.id] = false;
                delete lastPlayingCheck[user.id];
            }
        } else {
            
            delete lastOnlineCheck[user.id];
            delete lastPlayingCheck[user.id];
            delete lastGameState[user.id];
        }
    }
}

async function trackRobloxUser(client, robloxUserId) {
    const badgescount = settings.badgescount || 0;
    const gamecount = settings.gamecount || 0;

    try {
        const badgePlaceIds = await getLatestBadges(robloxUserId, badgescount);
        const favoritePlaceIds = await getFavoriteGames(robloxUserId, gamecount);

        const allPlaceIds = [...new Set([...badgePlaceIds, ...favoritePlaceIds])];

        if (placeIdQueue) {
            allPlaceIds.forEach(placeId => {
                
                if (favoritePlaceIds.includes(placeId)) {
                    console.log(`Searching favorite game: ${placeId}`);
                }
                placeIdQueue.push(() => processPlaceId(client, robloxUserId, placeId));
            });

            if (!placeIdQueue.running) {
                placeIdQueue.start();
            }
        } else {
            console.log("Queue not initialized yet");
        }

    } catch (error) {
        console.error("Error tracking Roblox user:", error);
        client.channels.fetch(channelId)
            .then(channel => channel.send("An error occurred while tracking the Roblox user."));
    }
}

async function processPlaceId(client, robloxUserId, placeId) {
    try {
        const universeId = await getUniverseId(placeId);
        const playerCount = await getPlayerCount(universeId);

        if (playerCount > 10000) {
            console.log(`Skipping game ${placeId} due to high player count (${playerCount})`);
            return;
        }

        console.log(`Processing game: ${placeId}`);

        const userData = await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`).then(res => res.json());
        const username = userData.name;

        const thumbnailData = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxUserId}&size=150x150&format=Png&isCircular=false`).then(res => res.json());
        const imgUrl = thumbnailData.data[0].imageUrl;

        const result = await find(imgUrl, placeId, username);

        if (result) {
            client.channels.fetch(channelId)
                .then(channel => channel.send(result));
        }
    } catch (error) {
        console.error("Error processing place ID:", error);
    }
}

client.on('messageCreate', async (message) => {
    if (message.content.startsWith('.add')) {
        const args = message.content.split(' ');
        const robloxUserId = args[1];
        fetch(`https://users.roblox.com/v1/users/${robloxUserId}`)
            .then(res => res.json())
            .then(data => {
                const username = data.name;
                trackedUsers.push({ id: robloxUserId, username: username });
                fs.writeFileSync('./ids.json', JSON.stringify({ tracked_users: trackedUsers }, null, 2));
                message.channel.send(`Added user ${username} (${robloxUserId}) to tracking.`);
            })
            .catch(error => {
                message.channel.send('Error adding user to tracking.');
                console.error('Error fetching Roblox user data:', error);
            });

    } else if (message.content.startsWith('.remove')) {
        const args = message.content.split(' ');
        const robloxUserId = args[1];
        const index = trackedUsers.findIndex(user => user.id === robloxUserId);
        if (index !== -1) {
            const removedUser = trackedUsers.splice(index, 1)[0];
                fs.writeFileSync('./ids.json', JSON.stringify({ tracked_users: trackedUsers }, null, 2));
                message.channel.send(`removed user ${removedUser.username} (${removedUser.id}) from tracking`);
            } else {
                message.channel.send('User not found in tracking list.');
            }
    } else if (message.content.startsWith('.track')) {
        const args = message.content.split(' ');
        if (args.length !== 3) {
            return message.channel.send('Usage: .track <robloxUserId> <gameId>');
        }
        const robloxUserId = args[1];
        const gameId = args[2];

        
        const universeId = await getUniverseId(gameId);
        const playerCount = await getPlayerCount(universeId);

        if (playerCount > 10000) {
            return message.channel.send(`Skipping game ${gameId} due to high player count (${playerCount})`);
        }

        
        message.channel.send(`Tracking user ${robloxUserId} in game ${gameId}...`);
        const result = await trackUserInGame(robloxUserId, gameId);
        message.channel.send(result);
    }
});

async function trackUserInGame(robloxUserId, gameId) {
    try {
        const universeId = await getUniverseId(gameId);
        const playerCount = await getPlayerCount(universeId);

        if (playerCount > 10000) {
            return `Skipping game ${gameId} due to high player count (${playerCount})`;
        }

        const userData = await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`).then(res => res.json());
        const username = userData.name;

        const thumbnailData = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxUserId}&size=150x150&format=Png&isCircular=false`).then(res => res.json());
        const imgUrl = thumbnailData.data[0].imageUrl;

        const result = await find(imgUrl, gameId, username);

        return result || `could not find ${username} in the game. (they might not be playing it)`;
    } catch (error) {
        console.error("Error tracking user in game:", error);
        return "An error occurred while tracking the user in the game.";
    }
}


client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    if (Queue) {
        executeTaskWithDelay();
    } else {
        console.log("Waiting for Queue to initialize...");
    }
});

async function executeTaskWithDelay() {
    while (true) {
        await delayedTask();
        
        if (placeIdQueue && !placeIdQueue.running && placeIdQueue.length > 0) {
            placeIdQueue.start();
        }
    }
}

async function delayedTask() {
    await new Promise(resolve => setTimeout(resolve, 30000));
    await checkTrackedUsers();
}
