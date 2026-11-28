import { NextApiRequest } from "next";
import { NextApiResponseServerIO } from "../../types/next";
import { Server as ServerIO } from "socket.io";
import { Server as NetServer } from "http";
import { CardId, ChoicePrompt, Message, RoomState } from "../../types/message";

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_MESSAGES_PER_ROOM = 200;

const globalForRooms = globalThis as unknown as {
  hexatombeRooms?: Map<string, RoomState>;
};

const roomsStore: Map<string, RoomState> =
  globalForRooms.hexatombeRooms || new Map<string, RoomState>();
globalForRooms.hexatombeRooms = roomsStore;

function getOrCreateRoom(roomName: string): RoomState {
  const existing = roomsStore.get(roomName);
  if (existing) return existing;
  const fresh: RoomState = {
    messages: [],
    locked: false,
    activeCard: null,
    activeChoice: null,
  };
  roomsStore.set(roomName, fresh);
  return fresh;
}

const socketio = async (req: NextApiRequest, res: NextApiResponseServerIO) => {
  if (!res.socket.server.io) {
    console.log("New Socket.io server...");
    const httpServer: NetServer = res.socket.server as any;
    const io = new ServerIO(httpServer, {
      path: "/api/socketio",
    });

    io.on("connection", (socket) => {
      const rawRoom = socket.request.headers.room;
      const room = (Array.isArray(rawRoom) ? rawRoom[0] : rawRoom) || "intencao";

      console.log(`Client ${socket.id} connected to room "${room}"`);
      socket.join(room);

      const state = getOrCreateRoom(room);
      socket.emit("roomState", state);
      io.emit("roomsList", Array.from(roomsStore.keys()));

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
      });

      socket.on("typingPreview", (text: string) => {
        socket.to(room).emit("typingPreview", text);
      });

      socket.on("toggleLock", (locked: boolean) => {
        const roomState = getOrCreateRoom(room);
        roomState.locked = locked;
        io.to(room).emit("lockState", locked);
      });

      socket.on("showCard", (cardId: CardId | null) => {
        const roomState = getOrCreateRoom(room);
        roomState.activeCard = cardId;
        io.to(room).emit("activeCard", cardId);
      });

      socket.on("triggerInvasion", () => {
        io.to(room).emit("triggerInvasion");
      });

      socket.on("stopInvasion", () => {
        io.to(room).emit("stopInvasion");
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

        // Envia o resultado apenas para o Mestre (não entra no chat do jogador)
        io.emit("choiceResult", {
          room,
          prompt: promptTitle,
          chosen: payload.chosen,
          timestamp: Date.now(),
        });
      });

      socket.on("clearRoom", () => {
        const roomState = getOrCreateRoom(room);
        roomState.messages = [];
        roomState.activeChoice = null;
        io.to(room).emit("roomState", roomState);
      });

      socket.on("deleteRoom", (targetRoom: string) => {
        roomsStore.delete(targetRoom);
        io.emit("roomsList", Array.from(roomsStore.keys()));
      });

      socket.on("requestRoomsList", () => {
        socket.emit("roomsList", Array.from(roomsStore.keys()));
      });
    });

    res.socket.server.io = io;
  }
  res.end();
};

export default socketio;
