export type EnergyBand = "low" | "medium" | "high" | "dynamic";

export type MixPlan = {
  name: string;
  description: string;
  coverPrompt: string;
  targetCount: number;
  genres: string[];
  moods: string[];
  energy: EnergyBand;
  anchorArtists: string[];
  seedTracks: string[];
  avoidArtists: string[];
  avoidTraits: string[];
  familiarityTarget: number;
  discoveryTarget: number;
  searchQueries: string[];
  rationale: string;
};

export type MixTrack = {
  id: string;
  uri?: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
  explicit?: boolean;
  imageUrl?: string;
  spotifyUrl?: string;
  source: "top" | "recent" | "saved" | "search" | "demo";
  familiar: boolean;
  genres?: string[];
  energy?: number;
  danceability?: number;
  fitProbability?: number;
};

export type MixRecord = {
  id: string;
  userId: string;
  prompt: string;
  name: string;
  description: string;
  coverPrompt: string;
  coverDataUrl?: string;
  tracks: MixTrack[];
  targetCount: number;
  status: "draft" | "saved" | "save_failed";
  spotifyUrl?: string;
  spotifyId?: string;
  createdAt: number;
  stats: {
    familiar: number;
    discoveries: number;
    jevEvaluated: number;
  };
};

export type SpotifySession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  user: {
    id: string;
    accountId?: string;
    displayName: string;
    imageUrl?: string;
    country?: string;
  };
};

export type PublicSession = {
  authenticated: boolean;
  demo: boolean;
  user?: SpotifySession["user"];
};
