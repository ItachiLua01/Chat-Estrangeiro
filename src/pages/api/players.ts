import type { NextApiRequest } from "next";
import fs from "fs";
import path from "path";
import { NextApiResponseServerIO } from "../../types/next";
import { loadExternalState, saveExternalState } from "../../lib/persistence";

export interface DossierPhoto {
  id: string;
  title: string;
  url: string;
  blurred: boolean;
}

export interface DossierAudio {
  id: string;
  title: string;
  url: string;
  locked: boolean;
}

export interface PlayerResources {
  water: number;
  food: number;
  scrap: number;
  daysWithoutWater: number;
  daysWithoutFood: number;
  fortitudeFails: number;
  pvPenalty: number;
  pePenalty: number;
}

export interface PlayerRecord {
  username: string;
  password: string;
  characterName: string;
  room: string;
  story: string;
  storyCensored: boolean;
  photos: DossierPhoto[];
  audios: DossierAudio[];
  resources: PlayerResources;
}

const DATA_FILE = path.join(process.cwd(), "src", "data", "players.json");

const globalPlayers = globalThis as unknown as {
  hexatombePlayers?: PlayerRecord[];
  hexatombePlayersLoadedExt?: boolean;
};

async function loadPlayers(): Promise<PlayerRecord[]> {
  if (!globalPlayers.hexatombePlayersLoadedExt) {
    globalPlayers.hexatombePlayersLoadedExt = true;
    const ext = await loadExternalState<PlayerRecord[]>("hexatombe_players");
    if (ext && Array.isArray(ext)) {
      globalPlayers.hexatombePlayers = ext;
      return ext;
    }
  }
  if (globalPlayers.hexatombePlayers) return globalPlayers.hexatombePlayers;
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    globalPlayers.hexatombePlayers = parsed.players || [];
  } catch {
    globalPlayers.hexatombePlayers = [];
  }
  return globalPlayers.hexatombePlayers!;
}

function savePlayers(players: PlayerRecord[]) {
  globalPlayers.hexatombePlayers = players;
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ players }, null, 2),
      "utf-8"
    );
  } catch {}
  saveExternalState("hexatombe_players", players);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  const players = await loadPlayers();

  if (req.method === "GET") {
    const { username } = req.query;
    if (typeof username === "string") {
      const found = players.find(
        (p) => p.username.toLowerCase() === username.toLowerCase()
      );
      if (!found) return res.status(404).json({ error: "Jogador não encontrado" });
      return res.status(200).json({ player: found });
    }
    return res.status(200).json({ players });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const action = body.action || req.query.action;

    if (action === "login") {
      const user = String(body.username || "").trim();
      const pass = String(body.password || "");
      const found = players.find(
        (p) =>
          p.username.toLowerCase() === user.toLowerCase() && p.password === pass
      );
      if (!found) {
        return res.status(401).json({ error: "Usuário ou senha inválidos" });
      }
      return res.status(200).json({ player: found });
    }

    if (action === "upsert") {
      const incoming = body.player as PlayerRecord;
      if (!incoming || !incoming.username) {
        return res.status(400).json({ error: "username obrigatório" });
      }
      const idx = players.findIndex(
        (p) => p.username.toLowerCase() === incoming.username.toLowerCase()
      );
      if (idx >= 0) {
        players[idx] = incoming;
      } else {
        players.push(incoming);
      }
      savePlayers(players);

      res.socket?.server?.io?.emit("dossierUpdated", {
        username: incoming.username,
        player: incoming,
      });

      return res.status(200).json({ player: incoming, players });
    }

    if (action === "resources") {
      const user = String(body.username || "");
      const idx = players.findIndex(
        (p) => p.username.toLowerCase() === user.toLowerCase()
      );
      if (idx < 0) return res.status(404).json({ error: "Jogador não encontrado" });
      players[idx].resources = body.resources;
      savePlayers(players);
      res.socket?.server?.io?.emit("resourcesUpdated", {
        username: players[idx].username,
        resources: body.resources,
      });
      return res.status(200).json({ player: players[idx] });
    }

    if (action === "delete") {
      const user = String(body.username || "");
      const next = players.filter(
        (p) => p.username.toLowerCase() !== user.toLowerCase()
      );
      savePlayers(next);
      return res.status(200).json({ players: next });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
