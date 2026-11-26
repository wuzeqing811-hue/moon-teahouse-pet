export type Point = { x: number; y: number };
export type ChatSize = { width: number; height: number };
export type ReactionId = 'tea-serve' | 'shy-wink' | 'moon-bow' | 'scent' | 'tail-wag' | 'leaf-pounce'
  | 'catnap';
export type Animation = { frames: string[]; fps: number; loop: boolean; label?: string; reaction?: ReactionId; wave?: true };
export type Outfit = {
  id: string; name: string; characterId: string; characterName: string; persona: string;
  animations: Record<string, Animation>; mask: string; tray?: string;
  defaultSize: { width: number; height: number }; canvas: { width: number; height: number; anchor: Point };
};
export type LocalProvider = 'deepseek' | 'qwen' | 'ollama';
export type Settings = {
  chatSize: ChatSize;
  localProvider: LocalProvider;
  model: string; cloudEnabled: boolean; cloudEndpoint: string; cloudModel: string;
  cloudProvider: 'compatible' | 'deepseek'; deepseekThinking: boolean;
  searchProvider: 'ddgs' | 'searxng' | 'deepseek'; pythonPath: string; searxngUrl: string;
  contextTurns: number; autoLaunch: boolean;
};
export type SettingsView = Settings & { hasCloudKey: boolean; hasDeepSeekKey: boolean; size: number; canAutoLaunch: boolean };
export type SettingsUpdate = Partial<Settings> & { cloudKey?: string; deepseekKey?: string };
export type SearchResult = { title: string; snippet: string; url: string };
export type Citation = { end: number; url: string };
export type Message = { role: 'user' | 'assistant'; content: string; sources?: SearchResult[]; citations?: Citation[]; truncated?: boolean };
export type ModelStatus = { models: string[]; activeModel?: string; provider?: 'local-deepseek' | 'local-qwen' | 'ollama' | 'cloud' | 'deepseek'; detail: string;
  localState?: 'loading' | 'ready' | 'error' };
export type PetInput = { kind: 'down' | 'move' | 'up' | 'cancel' } & Point;
export type Garment = { id: string; name: string; cut: string; color: string; shade: string; trim: string; accent: string; motif: string };
export type Bottom = Garment & { kind: 'pants' | 'skirt' };
export type WardrobeCatalog = { tops: Garment[]; bottoms: Bottom[]; hairs: { id: string; name: string }[]; defaults: Record<string, { top: string; bottom: string }> };
export type Look = { top: string; bottom: string; hair: string; hairColor: string; eyeColor: string; active: boolean };
export type CustomLook = { top: Garment; bottom: Bottom; hair: string; hairColor: string; eyeColor: string };
export type ClipSpec = { fps: number; count: number };
export type ClipSet = { root: string; available: string[]; bake: boolean; specs: Record<string, ClipSpec> };
export type BakedClip = { video: Uint8Array; hits: Uint8Array };
export type WardrobeState = { catalog: WardrobeCatalog; outfits: Outfit[]; currentId: string; looks: Record<string, Look> };
export type PetSnapshot = { outfit: Outfit; action: string; revision: number; assetRevision: number; look?: CustomLook; media?: ClipSet };
export type ChatSnapshot = { outfit: Outfit; messages: Message[]; settings: SettingsView; status: ModelStatus };
export type ChatRequest = { id: string; characterId: string; message: string; useSearch: boolean };
export type ChatEvent = { id: string; text?: string; sources?: SearchResult[]; stage?: 'thinking' | 'searching' | 'reading' };
export type PanelEvent = 'chat' | 'settings' | 'pet-size';
export interface PetAPI {
  pet: {
    getState(): Promise<PetSnapshot>; onState(callback: (snapshot: PetSnapshot) => void): () => void;
    input(input: PetInput): void; wheel(delta: number): void; ready(assetRevision: number, pixels?: Uint8Array): void;
    poseMask(revision: number, pixels: Uint8Array): void;
    ended(revision: number): void;
    saveClip(assetRevision: number, action: string, clip: BakedClip): Promise<void>;
    hide(): Promise<void>; show(): Promise<void>; setSize(size: { width: number; height: number }): Promise<number>;
    getSize(): Promise<number>; getOutfits(): Promise<Outfit[]>; selectOutfit(id: string): Promise<void>;
    importOutfit(): Promise<Outfit | null>; reloadOutfits(): Promise<Outfit[]>;
  };
  chat: {
    getState(): Promise<ChatSnapshot>; send(request: ChatRequest): Promise<Message>; cancel(id: string): Promise<void>;
    resize(size: ChatSize): Promise<ChatSize>;
    onChunk(callback: (event: ChatEvent) => void): () => void;
    onOutfit(callback: (outfit: Outfit) => void): () => void;
    onPanel(callback: (panel: PanelEvent) => void): () => void;
    onModel(callback: (status: ModelStatus) => void): () => void;
    hide(): Promise<void>; openSource(url: string): Promise<void>;
    history(characterId: string): Promise<Message[]>;
  };
  settings: { save(update: SettingsUpdate): Promise<SettingsView>; checkModel(retry?: boolean): Promise<ModelStatus>; testDeepSeek(): Promise<string> };
  search: { query(query: string): Promise<SearchResult[]> };
  wardrobe: { open(): Promise<void>; getState(): Promise<WardrobeState>; apply(characterId: string, look: Look): Promise<WardrobeState>;
    preset(characterId: string): Promise<WardrobeState>; close(): void };
}
