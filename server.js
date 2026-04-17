// ============================================================
	//  TikTok Live → Roblox Bridge Server
//  Multi-session version: one TikTok live per Roblox server
// ============================================================

	const { WebcastPushConnection } = require("tiktok-live-connector");
const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;
const SECRET_KEY = "myparkourkey123";

// sessions[serverId] = {
	//   tiktokLive,
	//   eventQueue,
	//   followedUsersThisLive,
	//   userLikeCounts
	// }
const sessions = {};

const LIKE_THRESHOLD = 150;

// ── GIFTS ─────────────────────────────────────────────────
const GIFT_MAP = {
	// BAD GIFTS
	"GG": { type: "bad", power: 3, label: "GG" },
	"Overreact": { type: "bad", power: 20, label: "Overreact" },
	"Frienship Necklace": { type: "bad", power: 30, label: "TeddyBearChain" },
	"Perfume": { type: "bad", power: 150, label: "Perfume" },
	"Confetti": { type: "bad", power: 300, label: "Confetti" },
	"Sunglasses": { type: "bad", power: 500, label: "Sunglasses" },
	"Galaxy": { type: "bad", power: 1, label: "TotalReset" },
	"Teddy Bear": { type: "bad", power: 1, label: "ScoreDown" },
	"Glowing Jellyfish": { type: "bad", power: 3, label: "ScoreDown" },
	"Leon the Kitten": { type: "bad", power: 8, label: "ScoreDown" },

	// GOOD GIFTS
	"Rose": { type: "boost", power: 3, label: "Rose" },
	"Finger Heart": { type: "boost", power: 20, label: "FingerHeart" },
	"Rosa": { type: "boost", power: 30, label: "Rosa" },
	"Doughnut": { type: "boost", power: 150, label: "Doughnut" },
	"Hat and Mustache": { type: "boost", power: 300, label: "HatAndMustache" },
	"Hearts": { type: "boost", power: 500, label: "PinkHeartWithFace" },
	"Money Gun": { type: "boost", power: 1, label: "ScoreUp" },
	"Watermelon Love": { type: "boost", power: 3, label: "ScoreUp" },
	"Flying Jets": { type: "boost", power: 8, label: "ScoreUp" },
};

function getOrCreateSession(serverId) {
	if (!sessions[serverId]) {
		sessions[serverId] = {
			tiktokLive: null,
			currentUsername: null,
			eventQueue: [],
			followedUsersThisLive: new Set(),
			userLikeCounts: new Map(),
		};
	}
		return sessions[serverId];
		}

		function resetSessionState(session) {
			session.eventQueue = [];
			session.followedUsersThisLive = new Set();
			session.userLikeCounts = new Map();
			}

			function attachLiveListeners(session, serverId, connection) {
				connection.on("gift", (data) => {
					const giftName = data.giftName;
					const sender = data.uniqueId;

					// streak gifts: only handle once when streak ends
					if (data.giftType === 1 && !data.repeatEnd) {
						return;
						}

						const count = data.repeatCount || 1;

						console.log(`🎁 [${serverId}] Gift: ${giftName} x${count} from @${sender}`);

						const mapped = GIFT_MAP[giftName];
						if (mapped) {
							console.log("MAPPED GIFT =>", {
								serverId,
								originalGiftName: giftName,
								mappedLabel: mapped.label,
								mappedType: mapped.type,
								mappedPower: mapped.power * count,
								repeatCount: count,
								sender: sender,
							});

							session.eventQueue.push({
								event: mapped.type === "boost" ? "GiftBoost" : "GiftBad",
								gift: mapped.label,
								power: mapped.power * count,
								sender: sender,
							});
							} else {
	console.log(`⚠️ [${serverId}] Unknown gift: ${giftName}`);
	}
	});

	connection.on("like", (data) => {
		const sender = data.uniqueId;
		const incomingLikes = data.likeCount || 1;

		const current = session.userLikeCounts.get(sender) || 0;
		const updated = current + incomingLikes;
		session.userLikeCounts.set(sender, updated);

		console.log(`❤️ [${serverId}] ${sender} total likes this live: ${updated}`);

		while ((session.userLikeCounts.get(sender) || 0) >= LIKE_THRESHOLD) {
			session.userLikeCounts.set(
				sender,
				(session.userLikeCounts.get(sender) || 0) - LIKE_THRESHOLD
			);

			session.eventQueue.push({
				event: "LikeBoost",
				gift: "Likes",
				power: 5,
				sender,
			});

			console.log(`🚀 [${serverId}] ${sender} triggered +5 tiles from 150 likes`);
			}
	});

	connection.on("follow", (data) => {
		const sender = data.uniqueId;
		if (session.followedUsersThisLive.has(sender)) return;

			session.followedUsersThisLive.add(sender);

			console.log(`➕ [${serverId}] New unique follower: @${sender} — player moved back 5 tiles`);
			session.eventQueue.push({
				event: "FollowBad",
				gift: "Follow",
				power: 5,
				sender,
			});
	});

	connection.on("chat", () => {
		// no chat effects right now
	});

	connection.on("streamEnd", () => {
		console.log(`📴 [${serverId}] Live ended for @${session.currentUsername}`);
	});
	}

	async function connectToLive(serverId, username) {
		const cleanUsername = String(username || "").trim().replace(/^@+/, "");
		if (!cleanUsername) {
			throw new Error("Missing username");
			}

			const session = getOrCreateSession(serverId);

			if (session.tiktokLive) {
				try {
					console.log(`Disconnecting previous live for [${serverId}]: @${session.currentUsername}`);
					session.tiktokLive.disconnect();
				} catch (err) {
					console.warn(`Error disconnecting previous live for [${serverId}]:`, err.message);
				}
				session.tiktokLive = null;
				}

				resetSessionState(session);

				const connection = new WebcastPushConnection(cleanUsername);
				await connection.connect();

				session.currentUsername = cleanUsername;
				session.tiktokLive = connection;

				attachLiveListeners(session, serverId, connection);

				console.log(`✅ [${serverId}] Connected to TikTok Live: @${cleanUsername}`);
				return cleanUsername;
				}

		// ── CONNECT ENDPOINT ───────────────────────────────────────
		app.get("/connect", async (req, res) => {
			if (req.query.key !== SECRET_KEY) {
				return res.status(403).json({ error: "Forbidden" });
			}

			const username = req.query.username;
			const serverId = req.query.serverId;

			if (!username || !serverId) {
				return res.status(400).json({ error: "Missing username or serverId" });
				}

				try {
					const connected = await connectToLive(serverId, username);
					return res.json({
						ok: true,
						connectedTo: connected,
						serverId,
					});
				} catch (err) {
					console.error(`❌ [${serverId}] Failed to connect:`, err.message);
					return res.status(500).json({
						ok: false,
						error: err.message,
						serverId,
					});
				}
		});

		// ── ROBLOX POLLS EVENTS ───────────────────────────────────
		app.get("/events", (req, res) => {
			if (req.query.key !== SECRET_KEY) {
				return res.status(403).json({ error: "Forbidden" });
			}

			const serverId = req.query.serverId;
			if (!serverId || !sessions[serverId]) {
				return res.json({ events: [] });
				}

				const session = sessions[serverId];
				const toSend = [...session.eventQueue];
				session.eventQueue = [];

				res.json({
					currentUsername: session.currentUsername,
					events: toSend,
				});
		});

		app.get("/", (req, res) => {
			res.send("TikTok Roblox Bridge multi-session server is running!");
		});

		app.listen(PORT, () => {
			console.log(`🌐 Bridge server running at http://localhost:${PORT}`);
			console.log(`🔗 Connect endpoint: http://localhost:${PORT}/connect?key=${SECRET_KEY}&serverId=SERVER_ID&username=USERNAME`);
		});