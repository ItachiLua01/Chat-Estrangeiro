import { NextApiRequest } from "next";
import { NextApiResponseServerIO } from "../../types/next";
import { Server as ServerIO } from "socket.io";
import { Server as NetServer } from "http";
import { CardId, ChoicePrompt, Message, RoomState } from "../../types/message";
import { loadExternalState, saveExternalState } from "../../lib/persistence";

export const config = {
  api: {
    bodyParser: false,
  },
};

export interface BaseUpgradeState {
  id: string;
  built: boolean;
  discovered: boolean;
}

const DEFAULT_BASE: BaseUpgradeState[] = [
  { id: "limpeza", built: false, discovered: true },
  { id: "filtro_agua", built: false, discovered: true },
  { id: "geladeira", built: false, discovered: true },
  { id: "camas", built: false, discovered: true },
  { id: "casa_arvore", built: false, discovered: true },
  { id: "defesas", built: false, discovered: true },
  { id: "academia", built: false, discovered: true },
  { id: "enfermaria", built: false, discovered: false },
  { id: "biblioteca", built: false, discovered: false },
  { id: "sala_musica", built: false, discovered: false },
  { id: "adega_vinho", built: false, discovered: false },
  { id: "garagem", built: false, discovered: false },
];

const MAX_MESSAGES_PER_ROOM = 200;

const globalForRooms = globalThis as unknown as {
  hexatombeRooms?: Map<string, RoomState>;
  hexatombeBase?: BaseUpgradeState[];
  hexatombePresence?: Map<string, Map<string, { name: string; isMaster: boolean }>>;
  hexatombeExtLoaded?: boolean;
};

const roomsStore: Map<string, RoomState> =
  globalForRooms.hexatombeRooms || new Map<string, RoomState>();
globalForRooms.hexatombeRooms = roomsStore;

const presenceStore =
  globalForRooms.hexatombePresence ||
  new Map<string, Map<string, { name: string; isMaster: boolean }>>();
globalForRooms.hexatombePresence = presenceStore;

function getOrCreateRoom(roomName: string): RoomState {
  const existing = roomsStore.get(roomName);
  if (existing) {
    if (!existing.unlockedCards) existing.unlockedCards = [];
    return existing;
  }
  const fresh: RoomState = {
    messages: [],
    locked: false,
    activeCard: null,
    unlockedCards: [],
    activeChoice: null,
  };
  roomsStore.set(roomName, fresh);
  return fresh;
}

function persistRoomsDebounced() {
  const obj: Record<string, RoomState> = {};
  roomsStore.forEach((v, k) => {
    obj[k] = v;
  });
  saveExternalState("hexatombe_rooms", obj);
}

function emitPresence(io: ServerIO, room: string) {
  const map = presenceStore.get(room);
  const players: string[] = [];
  if (map) {
    map.forEach((v) => {
      if (!v.isMaster) players.push(v.name || "Jogador");
    });
  }
  io.to(room).emit("roomPresence", {
    room,
    count: players.length,
    users: players,
  });
}

const socketio = async (req: NextApiRequest, res: NextApiResponseServerIO) => {
  if (!globalForRooms.hexatombeExtLoaded) {
    globalForRooms.hexatombeExtLoaded = true;
    const extRooms = await loadExternalState<Record<string, RoomState>>("hexatombe_rooms");
    if (extRooms) {
      Object.entries(extRooms).forEach(([k, v]) => roomsStore.set(k, v));
    }
    const extBase = await loadExternalState<BaseUpgradeState[]>("hexatombe_base");
    if (extBase && Array.isArray(extBase)) {
      globalForRooms.hexatombeBase = extBase;
    }
  }

  if (!globalForRooms.hexatombeBase) {
    globalForRooms.hexatombeBase = DEFAULT_BASE;
  }

  if (!res.socket.server.io) {
    console.log("New Socket.io server...");
    const httpServer: NetServer = res.socket.server as any;
    const io = new ServerIO(httpServer, {
      path: "/api/socketio",
    });

    io.on("connection", (socket) => {
      const rawRoom = socket.request.headers.room;
      const room = (Array.isArray(rawRoom) ? rawRoom[0] : rawRoom) || "intencao";
      const rawUser = socket.request.headers.username;
      const username = (Array.isArray(rawUser) ? rawUser[0] : rawUser) || room;

      socket.join(room);

      if (!presenceStore.has(room)) {
        presenceStore.set(room, new Map());
      }
      presenceStore.get(room)!.set(socket.id, {
        name: username,
        isMaster: false,
      });

      const state = getOrCreateRoom(room);
      socket.emit("roomState", state);
      socket.emit("baseState", globalForRooms.hexatombeBase);
      io.emit("roomsList", Array.from(roomsStore.keys()));
      emitPresence(io, room);

      socket.on("identifyPresence", (payload: { name?: string; isMaster?: boolean }) => {
        const roomMap = presenceStore.get(room);
        if (roomMap) {
          roomMap.set(socket.id, {
            name: payload?.name || room,
            isMaster: !!payload?.isMaster,
          });
          emitPresence(io, room);
        }
      });

      socket.on("sendMessage", (incoming: Message) => {
        const targetRoom = incoming.room || room;
        const roomState = getOrCreateRoom(targetRoom);

        const msg: Message = {
          ...incoming,
          id: incoming.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          room: targetRoom,
          timestamp: incoming.timestamp || Date.now(),
        };

        if (!msg.ephemeral) {
          roomState.messages.push(msg);
          if (roomState.messages.length > MAX_MESSAGES_PER_ROOM) {
            roomState.messages.shift();
          }
          persistRoomsDebounced();
        }

        io.to(targetRoom).emit("message", msg);
      });

      socket.on("broadcastAll", (incoming: Omit<Message, "room">) => {
        const allRooms = Array.from(roomsStore.keys());
        allRooms.forEach((targetRoom) => {
          const roomState = getOrCreateRoom(targetRoom);
          const msg: Message = {
            ...incoming,
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            room: targetRoom,
            timestamp: Date.now(),
          };
          if (!msg.ephemeral) {
            roomState.messages.push(msg);
            if (roomState.messages.length > MAX_MESSAGES_PER_ROOM) {
              roomState.messages.shift();
            }
          }
          io.to(targetRoom).emit("message", msg);
        });
        persistRoomsDebounced();
      });

      socket.on("typingPreview", (text: string) => {
        socket.to(room).emit("typingPreview", text);
      });

      socket.on("masterTyping", (typing: boolean) => {
        socket.to(room).emit("masterTyping", typing);
      });

      socket.on("toggleLock", (locked: boolean) => {
        const roomState = getOrCreateRoom(room);
        roomState.locked = locked;
        persistRoomsDebounced();
        io.to(room).emit("lockState", locked);
      });

      socket.on("showCard", (cardId: CardId | null) => {
        const roomState = getOrCreateRoom(room);
        roomState.activeCard = cardId;
        if (cardId && !roomState.unlockedCards.includes(cardId)) {
          roomState.unlockedCards.push(cardId);
          io.to(room).emit("unlockedCards", roomState.unlockedCards);
        }
        persistRoomsDebounced();
        io.to(room).emit("activeCard", cardId);
      });

      socket.on("triggerInvasion", () => {
        io.to(room).emit("triggerInvasion");
      });

      socket.on("stopInvasion", () => {
        io.to(room).emit("stopInvasion");
      });

      socket.on("triggerMacabraText", (payload: { text: string; allRooms?: boolean }) => {
        if (payload.allRooms) {
          io.emit("macabraText", { text: payload.text });
        } else {
          io.to(room).emit("macabraText", { text: payload.text });
        }
      });

      socket.on("triggerBloodMoon", (payload: { from: string; to: string }) => {
        io.emit("bloodMoon", payload);
      });

      socket.on("resetFirstScream", () => {
        io.to(room).emit("resetFirstScream");
      });

      socket.on("sendChoice", (choice: ChoicePrompt) => {
        const roomState = getOrCreateRoom(room);
        roomState.activeChoice = choice;
        io.to(room).emit("activeChoice", choice);
      });

      socket.on("sendChoiceAll", (choice: ChoicePrompt) => {
        const allRooms = Array.from(roomsStore.keys());
        allRooms.forEach((targetRoom) => {
          const roomState = getOrCreateRoom(targetRoom);
          roomState.activeChoice = choice;
          io.to(targetRoom).emit("activeChoice", choice);
        });
      });

      socket.on("resolveChoice", (payload: { choiceId: string; chosen: string }) => {
        const roomState = getOrCreateRoom(room);
        if (!roomState.activeChoice || roomState.activeChoice.id !== payload.choiceId) {
          return;
        }
        const promptTitle = roomState.activeChoice.prompt;
        roomState.activeChoice = null;
        io.to(room).emit("activeChoice", null);

        io.emit("choiceResult", {
          room,
          prompt: promptTitle,
          chosen: payload.chosen,
          timestamp: Date.now(),
        });
      });

      socket.on("updateBaseState", (nextBase: BaseUpgradeState[]) => {
        globalForRooms.hexatombeBase = nextBase;
        saveExternalState("hexatombe_base", nextBase);
        io.emit("baseState", nextBase);
      });

      socket.on("importRoomLog", (payload: { messages?: Message[]; unlockedCards?: CardId[] }) => {
        const roomState = getOrCreateRoom(room);
        if (Array.isArray(payload.messages)) {
          roomState.messages = payload.messages.slice(-MAX_MESSAGES_PER_ROOM);
        }
        if (Array.isArray(payload.unlockedCards)) {
          roomState.unlockedCards = payload.unlockedCards;
        }
        persistRoomsDebounced();
        io.to(room).emit("roomState", roomState);
      });

      socket.on("clearRoom", () => {
        const roomState = getOrCreateRoom(room);
        roomState.messages = [];
        roomState.activeChoice = null;
        persistRoomsDebounced();
        io.to(room).emit("roomState", roomState);
      });

      socket.on("deleteRoom", (targetRoom: string) => {
        roomsStore.delete(targetRoom);
        persistRoomsDebounced();
        io.emit("roomsList", Array.from(roomsStore.keys()));
      });

      socket.on("requestRoomsList", () => {
        socket.emit("roomsList", Array.from(roomsStore.keys()));
      });

      socket.on("requestBaseState", () => {
        socket.emit("baseState", globalForRooms.hexatombeBase);
      });

      socket.on("disconnect", () => {
        const roomMap = presenceStore.get(room);
        if (roomMap) {
          roomMap.delete(socket.id);
          emitPresence(io, room);
        }
      });
    });

    res.socket.server.io = io;
  }
  res.end();
};

export default socketio;
