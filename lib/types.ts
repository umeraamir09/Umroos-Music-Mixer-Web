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
  // Named albums are playlist composition preferences unless the request says
  // they are exclusive. Their spelling is preserved for display/search.
  preferredAlbums?: string[];
  // Empty means unrestricted. Otherwise every track must credit an allowed artist.
  allowedArtists: string[];
  seedTracks: string[];
  referenceTracks: { name: string; artist: string }[];
  soundProfile: string;
  avoidArtists: string[];
  avoidTraits: string[];
  familiarityTarget: number;
  discoveryTarget: number;
  searchQueries: string[];
  rationale: string;
};

// Last.fm listening-data similarity between a candidate and a named reference
// recording, normalized to 0..1 (1 = strongest similar track in the response).
export type TrackSimilarity = { ref: string; match: number };

export type MixTrack = {
  id: string;
  uri?: string;
  name: string;
  artists: string[];
  album: string;
  releaseYear?: number;
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
  // Explicit Jev rejection must survive selection and backfilling.
  meetsRequest?: boolean;
  fitSource?: "jev" | "local";
  // Deterministic enrichment (Reccobeats audio analysis, Last.fm community
  // metadata, MusicBrainz curated identifiers/genres). Never contains
  // popularity or play counts: those stay hidden from Jev.
  isrc?: string;
  mbid?: string;
  tempo?: number;
  valence?: number;
  acousticness?: number;
  instrumentalness?: number;
  speechiness?: number;
  liveness?: number;
  loudness?: number;
  tags?: string[];
  tagSummary?: string;
  similarTo?: TrackSimilarity[];
  enriched?: { reccobeats?: boolean; lastfm?: boolean; musicbrainz?: boolean };
};

// Enrichment facts about the plan itself (tag definitions) fed to Jev alongside
// the candidates. Produced by the enrichment stage, not by the planner.
export type EnrichContext = { tagDefinitions?: Record<string, string> };

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
