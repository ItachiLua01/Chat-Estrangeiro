export type CardId = "intencao" | "estigma" | "pacto" | "memoria";

export interface Message {
  id: string;
  message: string;
  stranger: boolean;
  room: string;
  ephemeral?: boolean;
  mutateTo?: string;
  timestamp: number;
}

export interface ChoicePrompt {
  id: string;
  prompt: string;
  optionA: string;
  optionB: string;
  seconds: number;
  createdAt: number;
}

export interface RoomState {
  messages: Message[];
  locked: boolean;
  activeCard: CardId | null;
  activeChoice: ChoicePrompt | null;
}
