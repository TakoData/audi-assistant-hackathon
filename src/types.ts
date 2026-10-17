export type TakoCard = {
  id: string;
  title: string;
  embedUrl: string;
  imageUrl?: string;
  webpageUrl?: string;
  description?: string;
  sources: string[];
};

export type TakoAnswer = {
  answer: string;
  cards: TakoCard[];
  requestId?: string;
  elapsedMs?: number;
  attemptCount?: number;
};

export type AssistantPhase =
  | "off"
  | "armed"
  | "listening"
  | "thinking"
  | "recovering"
  | "speaking"
  | "complete"
  | "error";
