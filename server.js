// GENERAL WARNING:

/*
 * Using Render.com FREE tier:
 *
 * Render.com specific settings for this example (server.js):
 * - server does NOT accept connections using port numbers!
 *   (Godot Clients just supply your url (e.g. "wss:\\exampleproject.render.com" )
 * - HTML5-exports REQUIRE SSL ("wss:\\" instead of "ws:\\")
 *    and therefor a domainname, NO IP-adress!
 *
 * - Render.com will "spin" down your webservice/server.js if there are no incoming connections!
 *    (usually after 15-20 min.)
 * - it's enough to try "join" or "host" within your godot-game and wait ~30 sec to let it spin up again.
 * - websocket-connections might get closed after 5 min.
 *    This shouldn't be an issue for this script
 *
 *    for testing this shouldn't be a big issue.
*/

// < from render.com express helloworld */
// const express = require("express");
// const app = express(); */

/*
 * app.get('/', function(req, res){
 *   res.send('Hello World!');
 *   console.log('Hello World! sent!');
 * });
*/

// //const server = app.listen(port, () => console.log(`Example app listening on port ${port}!`));

// App listening on the below port

/* const server = app.listen(port, function(err){
 *    if (err) console.log(err);
 *    console.log("Server listening on PORT", port);
 *  });
 * server.keepAliveTimeout = 120 * 1000;
 * server.headersTimeout = 120 * 1000; */

//   from render.com express helloworld  >

const WebSocket = require("ws");
const crypto = require("crypto");

const MAX_PEERS = 256;
const MAX_LOBBIES = 64;
const PORT = process.env.PORT || 10000; // eslint-disable-line no-undef no-process-env


/* infos about port settings
*
*  Unix [1]:
*
* $ PORT=1234 node app.js
*
*  More permanently (for a login session) [2]:
* $ export PORT=1234
* $ node app.js
*
*    In Windows:
*
* set PORT=1234
*
*    In Windows PowerShell:
*
* $env:PORT = 1234
* [1] Process-lived, while the parent process that initiates is still running. If you close terminal, variable dies.
* [2] Close terminal, open a new one, variable still alive.
*
* from https://stackoverflow.com/questions/42656326/how-to-set-port-for-express-server-dynamically
*
* For Render: TODO ....
* in web interface, set Env. Variable: PORT - 1234
* ...
*/

const ALFNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const NO_LOBBY_TIMEOUT = 400;
const SEAL_CLOSE_TIMEOUT = 10000;
const PING_INTERVAL = 10000;

const STR_NO_LOBBY = "Have not joined lobby yet";
const STR_HOST_DISCONNECTED = "Room host has disconnected";
const STR_ONLY_HOST_CAN_SEAL = "Only host can seal the lobby";
const STR_SEAL_COMPLETE = "Seal complete";
const STR_TOO_MANY_LOBBIES = "Too many lobbies open, disconnecting";
const STR_ALREADY_IN_LOBBY = "Already in a lobby";
const STR_LOBBY_DOES_NOT_EXISTS = "Lobby does not exists";
const STR_LOBBY_IS_SEALED = "Lobby is sealed";
const STR_INVALID_FORMAT = "Invalid message format";
const STR_NEED_LOBBY = "Invalid message when not in a lobby";
const STR_SERVER_ERROR = "Server error, lobby not found";
const STR_INVALID_DEST = "Invalid destination";
const STR_INVALID_CMD = "Invalid command";
const STR_TOO_MANY_PEERS = "Too many peers connected";
const STR_INVALID_TRANSFER_MODE = "Invalid transfer mode, must be text";


/*
function randomInt (low, high) {
	return Math.floor(Math.random() * (high - low + 1) + low);
}
*/

function randomId () {
	return Math.abs(new Int32Array(crypto.randomBytes(4).buffer)[0]);
}

/*
function randomSecret () {
	let out = "";
	for (let i = 0; i < 5; i++) {
		out += ALFNUM[randomInt(0, ALFNUM.length - 1)];
	}
	return out;
}*/



function randomSecret () {
	return randomUUID().replace(/-/gi, '');
}

const ws_server = new WebSocket.Server({ port: PORT });

class ProtoError extends Error {
	constructor (code, message) {
		super(message);
		this.code = code;
	}
}

class Peer {
	constructor (id, ws) {
		this.id = id;
		this.ws = ws;
		this.lobby = "";
		// Close connection after 1 sec if client has not joined a lobby
		this.timeout = setTimeout(() => {
			if (!this.lobby) ws.close(4000, STR_NO_LOBBY);
		}, NO_LOBBY_TIMEOUT);
	}
}

class Lobby {
	constructor (name, host) {
		this.name = name;
		this.host = host;
		this.peers = [];
		this.sealed = false;
		this.closeTimer = -1;
		console.log(`Peer ${this.host} tries to create lobby ${this.name}`);
	}
	getPeerId (peer) {
		if (this.host === peer.id) return 1;
		return peer.id;
	}
	join (peer) {
		const assigned = this.getPeerId(peer);
		peer.ws.send(`I: ${assigned}\n`);
		console.log(`I:PeerId: ${assigned}\n`);
		this.peers.forEach((p) => {
			p.ws.send(`N: ${assigned}\n`); // send id of the new peer to old peers
			peer.ws.send(`N: ${this.getPeerId(p)}\n`); // send id of all old peers to new peer
			console.log(`to old peers: N: ${assigned};  to new peer: N: ${this.getPeerId(p)}`); 
		});
		this.peers.push(peer);
	}
	leave (peer) {
		const idx = this.peers.findIndex((p) => peer === p);
		if (idx === -1) return false;
		const assigned = this.getPeerId(peer);
		const close = assigned === 1;
		this.peers.forEach((p) => {
			// Room host disconnected, must close.
			if (close) p.ws.close(4000, STR_HOST_DISCONNECTED);
			// Notify peer disconnect.
			else p.ws.send(`D: ${assigned}\n`);
		});
		this.peers.splice(idx, 1);
		if (close && this.closeTimer >= 0) {
			// We are closing already.
			clearTimeout(this.closeTimer);
			this.closeTimer = -1;
		}
		return close;
	}
	seal (peer) {
		// Only host can seal
		if (peer.id !== this.host) {
			throw new ProtoError(4000, STR_ONLY_HOST_CAN_SEAL);
		}
		this.sealed = true;
		this.peers.forEach((p) => {
			p.ws.send("S: \n");
		});
		console.log(`Peer ${peer.id} sealed lobby ${this.name} ` +
			`with ${this.peers.length} peers`);
		this.closeTimer = setTimeout(() => {
			// Close peer connection to host (and thus the lobby)
			this.peers.forEach((p) => {
				p.ws.close(1000, STR_SEAL_COMPLETE);
			});
		}, SEAL_CLOSE_TIMEOUT);
	}
}

const lobbies = new Map();
let peersCount = 0;

function joinLobby (peer, pLobby) {
	let lobbyName = pLobby;
	console.log(`pLobby: ${pLobby}`);
	if (lobbyName === "") {
		if (lobbies.size >= MAX_LOBBIES) {
			throw new ProtoError(4000, STR_TOO_MANY_LOBBIES);
		}
		// Peer must not already be in a lobby
		if (peer.lobby !== "") {
			throw new ProtoError(4000, STR_ALREADY_IN_LOBBY);
		}
		lobbyName = "12345"		//randomSecret();
		lobbies.set(lobbyName, new Lobby(lobbyName, peer.id));
		console.log(`Peer ("Host") ${peer.id} created lobby ${lobbyName}`);
		console.log(`Open lobbies: ${lobbies.size}`);
	}
	/*
*	else {
*		if ((lobbyName != "") && (peer.lobby == "" )) {
*			if ( !lobbies.has(lobbyName) ) {
*				lobbies.set(lobbyName, new Lobby(lobbyName, peer.id));
*				console.log(`Peer ("Host") ${peer.id} created lobby ${lobbyName}`);
*				console.log(`Open lobbies: ${lobbies.size}`);
*			}
*		}
*	}
	*/
	const lobby = lobbies.get(lobbyName);
	/*
	var obj = Object.fromEntries(lobbies);
    var jsonString = JSON.stringify(obj);
	console.log(`All Lobbies: ${jsonString} `);
	*/
	if (!lobby) throw new ProtoError(4000, (lobbyName+STR_LOBBY_DOES_NOT_EXISTS));
	if (lobby.sealed) throw new ProtoError(4000, STR_LOBBY_IS_SEALED);
	peer.lobby = lobbyName;
	console.log(`Peer ${peer.id} joining lobby ${lobbyName} ` +
		`with ${lobby.peers.length} peers`);
	lobby.join(peer);
	lobby.peers.forEach( (member) => {
		console.log(`member ${member.id}  is in lobby ${lobbyName}\n`);
	});
	peer.ws.send(`J: ${lobbyName}\n`);
	
}

function parseMsg (peer, msg) {
	const sep = msg.indexOf("\n");
	if (sep < 0) throw new ProtoError(4000, STR_INVALID_FORMAT);

	const cmd = msg.slice(0, sep);
	if (cmd.length < 3) throw new ProtoError(4000, STR_INVALID_FORMAT);

	const data = msg.slice(sep);

	// Lobby joining.
	if (cmd.startsWith("J: ")) {
		console.log(cmd);		
		joinLobby(peer, cmd.substr(3).trim());
		return;
	}

	if (!peer.lobby) throw new ProtoError(4000, STR_NEED_LOBBY);
	const lobby = lobbies.get(peer.lobby);
	if (!lobby) throw new ProtoError(4000, STR_SERVER_ERROR);

	// Lobby sealing.
	if (cmd.startsWith("S: ")) {
		lobby.seal(peer);
		return;
	}

	// Message relaying format:
	//
	// [O|A|C]: DEST_ID\n
	// PAYLOAD
	//
	// O: Client is sending an offer.
	// A: Client is sending an answer.
	// C: Client is sending a candidate.
	let destId = parseInt(cmd.substr(3).trim());
	// Dest is not an ID.
	if (!destId) throw new ProtoError(4000, STR_INVALID_DEST);
	if (destId === 1) destId = lobby.host;
	const dest = lobby.peers.find((e) => e.id === destId);
	// Dest is not in this room.
	if (!dest) throw new ProtoError(4000, STR_INVALID_DEST);

	function isCmd (what) {
		return cmd.startsWith(`${what}: `);
	}
	if (isCmd("O") || isCmd("A") || isCmd("C")) {
		dest.ws.send(cmd[0] + ": " + lobby.getPeerId(peer) + data);
		return;
	}
	throw new ProtoError(4000, STR_INVALID_CMD);
}

ws_server.on("connection", (ws, request, client) => {
	if (peersCount >= MAX_PEERS) {
		ws.close(4000, STR_TOO_MANY_PEERS);
		return;
	}
	peersCount++;
	const id = randomId();
	const peer = new Peer(id, ws);
	console.log(`new Peer:  ${id}\n`);
	ws.on("message", (message) => {
		if (typeof message !== "string") {
			ws.close(4000, STR_INVALID_TRANSFER_MODE);
			return;
		}
		try {
			parseMsg(peer, message);
			console.log(`Received message ${message} from user ${client} --id ${id}, peerid ${peer.id}`);
		} catch (e) {
			const code = e.code || 4000;
			console.log(`Error parsing message from ${id}:\n` +
				message);
			ws.close(code, e.message);
		}
	});
	ws.on("close", (code, reason) => {
		peersCount--;
		console.log(`Connection with peer ${peer.id} closed ` +
			`with reason ${code}: ${reason}`);
		if (peer.lobby && lobbies.has(peer.lobby) &&
			lobbies.get(peer.lobby).leave(peer)) {
			lobbies.delete(peer.lobby);
			console.log(`Deleted lobby ${peer.lobby}`);
			console.log(`Open lobbies: ${lobbies.size}`);
			peer.lobby = "";
		}
		if (peer.timeout >= 0) {
			clearTimeout(peer.timeout);
			peer.timeout = -1;
		}
	});
	ws.on("error", (error) => {
		console.error(error);
	});
});

let intervalCount = 0;

const interval = setInterval(() => { // eslint-disable-line no-unused-vars
	let tmpstring = "";
	if (intervalCount == 0 ) {
		console.log(`Node js waiting for peers to connect on Port ${PORT}...`);
	}
	ws_server.clients.forEach( (ws) => {
		ws.ping();
	} );
	if (peersCount > 0) {
	console.log(`${intervalCount}   Listening on Port ${PORT}${tmpstring}, Pinged ${peersCount} peers.`);
	}
	intervalCount++;
	
}, PING_INTERVAL);
