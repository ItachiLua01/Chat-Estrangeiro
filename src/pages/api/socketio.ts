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

      // Envia histórico e estado atual da sala ao conectar (resolve perda no F5)
      const state = getOrCreateRoom(room);
      socket.emit("roomState", state);
      socket.emit("roomsList", Array.from(roomsStore.keys()));

      socket.on("sendMessage", (incoming: Message) => {
        const targetRoom = incoming.room || room;
        const roomState = getOrCreateRoom(targetRoom);

        const msg: Message = {
          ...incoming,
          id: incoming.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          room: targetRoom,
          timestamp: incoming.timestamp || Date.now(),
        };

        // Mensagens efêmeras não ficam salvas no histórico permanente
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

      socket.on("resetFirstScream", () => {
        io.to(room).emit("resetFirstScream");
      });

      socket.on("sendChoice", (choice: ChoicePrompt) => {
        const roomState = getOrCreateRoom(room);
        roomState.activeChoice = choice;
        io.to(room).emit("activeChoice", choice);
      });

      socket.on("resolveChoice", (payload: { choiceId: string; chosen: string }) => {
        const roomState = getOrCreateRoom(room);
        if (!roomState.activeChoice || roomState.activeChoice.id !== payload.choiceId) {
          return;
        }
        const promptTitle = roomState.activeChoice.prompt;
        roomState.activeChoice = null;
        io.to(room).emit("activeChoice", null);

        const resultMsg: Message = {
          id: `${Date.now()}-choice`,
          message: `[${promptTitle}] → ${payload.chosen}`,
          stranger: false,
          room,
          timestamp: Date.now(),
        };
        roomState.messages.push(resultMsg);
        io.to(room).emit("message", resultMsg);
      });

      socket.on("clearRoom", () => {
        const roomState = getOrCreateRoom(room);
        roomState.messages = [];
        roomState.activeChoice = null;
        io.to(room).emit("roomState", roomState);
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
